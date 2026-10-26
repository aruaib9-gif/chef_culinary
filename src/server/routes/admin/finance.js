// Finance: charges/credits, manual & online payments, receipts, refunds, debtors, reminders,
// sponsor invoices and income reports (spec §9.4, §10). Super admin only.
import { z } from 'zod'
import { Student, Invoice, Payment, User, Programme, Cohort, SponsorInvoice } from '../../db/models.js'
import { withTransaction } from '../../db/mongo.js'
import { config } from '../../config.js'
import { parse, idParam, id, optionalId, pagination, paged, requiredText, optionalText, optionalDate, dateStr } from '../../lib/validate.js'
import { resolveUpload, sendFile } from '../../lib/storage.js'
import { sendCsv } from '../../lib/csv.js'
import { audit } from '../../lib/audit.js'
import { formatKobo } from '../../lib/money.js'
import { accountSummary, instalmentSchedule, nextReceiptNumber, emailReceipt, studentForReceipt, settleGatewayPayment } from '../../lib/finance.js'
import { nextSponsorInvoiceNumber } from '../../lib/sequence.js'
import { verifyTransaction } from '../../lib/paystack.js'
import { receiptPdf, sponsorInvoicePdf } from '../../lib/pdf.js'
import { sendMail, layout } from '../../lib/mailer.js'
import { byIds, pick, contains, dayRange } from '../../lib/lookup.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { Router, badRequest, notFoundError, defer } from '../../http.js'

export const finance = new Router()
finance.use(requireSuperAdmin)

const CATEGORIES = ['tuition', 'application', 'registration', 'materials', 'uniform', 'project', 'short_course', 'event', 'certificate', 'other']
const METHODS = ['cash', 'transfer', 'bank_deposit', 'pos', 'cheque', 'card', 'ussd']
const pdf = (res, name, buf) => {
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${name}"`)
  res.send(buf)
}

// ── Student account ──────────────────────────────────────────────────────────

finance.get('/students/:id', async (req, res) => {
  const sid = idParam(req)
  const student = await studentForReceipt(sid)
  if (!student) throw notFoundError('Student not found')
  const [account, schedule, invoices, payments] = await Promise.all([
    accountSummary(sid),
    instalmentSchedule(sid),
    Invoice.find({ student_id: sid }).sort({ created_at: 1 }).lean(),
    Payment.find({ student_id: sid }).sort({ created_at: -1 }).lean(),
  ])
  const users = await byIds(User, [...invoices.map((i) => i.created_by), ...payments.map((p) => p.recorded_by)], 'full_name')
  res.json({
    student, account, schedule,
    invoices: invoices.map((i) => ({ ...i, created_by_name: pick(users, i.created_by, 'full_name') })),
    payments: payments.map((p) => ({ ...p, recorded_by_name: pick(users, p.recorded_by, 'full_name') })),
  })
})

const invoiceSchema = z.object({
  studentId: id,
  description: requiredText(200),
  category: z.enum(CATEGORIES).default('other'),
  kind: z.enum(['charge', 'discount', 'scholarship', 'sponsor']).default('charge'),
  amountKobo: z.coerce.number().int().positive('Enter an amount'),
  dueDate: optionalDate,
})

finance.post('/invoices', async (req, res) => {
  const b = parse(invoiceSchema, req.body)
  const s = await Student.findById(b.studentId, 'cohort_id').lean()
  if (!s) throw notFoundError('Student not found')
  const row = await Invoice.create({
    student_id: b.studentId, cohort_id: s.cohort_id, description: b.description, category: b.category, kind: b.kind,
    amount_kobo: b.amountKobo, due_date: b.dueDate ?? null, created_by: req.user.id,
  })
  await audit(req, `invoice.${b.kind}`, 'invoice', row._id, b)
  res.status(201).json(row)
})

// Charge every active student in a cohort (e.g. uniform or project fee).
finance.post('/invoices/bulk', async (req, res) => {
  const b = parse(invoiceSchema.omit({ studentId: true }).extend({ cohortId: id }), req.body)
  const students = await Student.find({ cohort_id: b.cohortId, status: 'active' }, '_id').lean()
  if (students.length) {
    await Invoice.insertMany(students.map((s) => ({
      student_id: s._id, cohort_id: b.cohortId, description: b.description, category: b.category, kind: b.kind,
      amount_kobo: b.amountKobo, due_date: b.dueDate ?? null, created_by: req.user.id,
    })))
  }
  await audit(req, 'invoice.bulk', 'cohort', b.cohortId, { ...b, count: students.length })
  res.status(201).json({ created: students.length })
})

finance.post('/invoices/:id/void', async (req, res) => {
  const { reason } = parse(z.object({ reason: requiredText(500) }), req.body)
  const row = await Invoice.findOneAndUpdate({ _id: idParam(req), voided_at: null }, { $set: { voided_at: new Date(), void_reason: reason } }, { returnDocument: 'after' }).lean()
  if (!row) throw notFoundError('Invoice not found or already voided')
  await audit(req, 'invoice.void', 'invoice', row._id, { reason })
  res.json(row)
})

// ── Payments ─────────────────────────────────────────────────────────────────

const paymentFilters = pagination.extend({
  status: z.enum(['pending', 'success', 'failed', 'refunded', 'cancelled']).optional().or(z.literal('')),
  method: z.string().max(30).optional(),
  from: dateStr.optional().or(z.literal('')),
  to: dateStr.optional().or(z.literal('')),
  programmeId: optionalId,
})

// Each filter adds one condition; the date range applies to the paid date (or created date if unpaid).
async function paymentQuery(f) {
  const and = []
  if (f.status) and.push({ status: f.status })
  if (f.method) and.push({ method: f.method })
  const range = dayRange(f.from, f.to)
  if (range) {
    const date = { $ifNull: ['$paid_at', '$created_at'] }
    and.push({ $expr: { $and: [...(range.$gte ? [{ $gte: [date, range.$gte] }] : []), ...(range.$lt ? [{ $lt: [date, range.$lt] }] : [])] } })
  }
  if (f.programmeId) {
    const ids = (await Student.find({ programme_id: f.programmeId }, '_id').lean()).map((s) => s._id)
    and.push({ student_id: { $in: ids } })
  }
  if (f.q) {
    const re = contains(f.q)
    const ids = (await Student.find({ $or: [{ first_name: re }, { last_name: re }, { student_number: re }] }, '_id').lean()).map((s) => s._id)
    and.push({ $or: [{ student_id: { $in: ids } }, { reference: re }, { receipt_number: re }] })
  }
  return and.length ? { $and: and } : {}
}

async function withStudentInfo(rows) {
  const students = await byIds(Student, rows.map((p) => p.student_id), 'student_number first_name last_name programme_id')
  const [programmes, users] = await Promise.all([
    byIds(Programme, [...students.values()].map((s) => s.programme_id), 'name'),
    byIds(User, rows.map((p) => p.recorded_by), 'full_name'),
  ])
  return rows.map((p) => {
    const s = students.get(String(p.student_id))
    return {
      ...p, student_number: s?.student_number ?? null, first_name: s?.first_name ?? null, last_name: s?.last_name ?? null,
      programme_name: pick(programmes, s?.programme_id, 'name'), recorded_by_name: pick(users, p.recorded_by, 'full_name'),
    }
  })
}

const byPaidDate = (a, b) => new Date(b.paid_at ?? b.created_at) - new Date(a.paid_at ?? a.created_at)

finance.get('/payments', async (req, res) => {
  const f = parse(paymentFilters, req.query)
  const q = await paymentQuery(f)
  const [rows, total, received] = await Promise.all([
    Payment.aggregate([
      { $match: q },
      { $addFields: { _sort: { $ifNull: ['$paid_at', '$created_at'] } } },
      { $sort: { _sort: -1 } },
      { $skip: (f.page - 1) * f.pageSize },
      { $limit: f.pageSize },
      { $project: { _sort: 0 } },
    ]),
    Payment.countDocuments(q),
    Payment.aggregate([{ $match: { ...q, status: 'success' } }, { $group: { _id: null, t: { $sum: '$amount_kobo' } } }]),
  ])
  res.json({ ...paged(await withStudentInfo(rows), total, f), receivedKobo: received[0]?.t ?? 0 })
})

finance.get('/payments/export.csv', async (req, res) => {
  const rows = (await withStudentInfo(await Payment.find(await paymentQuery(parse(paymentFilters, req.query))).lean())).sort(byPaidDate)
  sendCsv(res, 'payments.csv', rows, [
    { key: 'paid_at', label: 'Date' }, { key: 'receipt_number', label: 'Receipt' }, { key: 'student_number', label: 'Student ID' },
    { label: 'Student', value: (r) => `${r.first_name} ${r.last_name}` }, { key: 'programme_name', label: 'Programme' },
    { key: 'purpose', label: 'Purpose' }, { key: 'method', label: 'Method' }, { key: 'reference', label: 'Reference' },
    { label: 'Amount (NGN)', value: (r) => (r.amount_kobo / 100).toFixed(2) }, { key: 'status', label: 'Status' }, { key: 'recorded_by_name', label: 'Recorded by' },
  ])
})

const manualSchema = z.object({
  studentId: id,
  amountKobo: z.coerce.number().int().positive('Enter an amount'),
  method: z.enum(METHODS),
  purpose: requiredText(200),
  reference: optionalText(120),
  paidAt: dateStr.optional().or(z.literal('').transform(() => undefined)),
  invoiceId: optionalId,
  notes: optionalText(2000),
  proofFileId: optionalId,
})

// Cash / bank deposit recorded by the office, with optional proof of payment (spec §10 "Offline payments").
// Proof: { proofFileId } from a direct upload, or a small multipart `proof` file.
finance.post('/payments', async (req, res) => {
  const b = parse(manualSchema, req.body)
  if (!(await Student.exists({ _id: b.studentId }))) throw notFoundError('Student not found')
  const proof = await resolveUpload(req, { purpose: 'payment_proof', field: 'proofFileId' })
  const payment = await withTransaction(async (session) => {
    const receipt = await nextReceiptNumber(session)
    const [row] = await Payment.create([{
      student_id: b.studentId, invoice_id: b.invoiceId, amount_kobo: b.amountKobo, purpose: b.purpose, method: b.method,
      reference: b.reference || receipt, status: 'success', paid_at: b.paidAt ? new Date(`${b.paidAt}T12:00:00Z`) : new Date(),
      receipt_number: receipt, gateway: 'manual', proof_file_id: proof?._id ?? null, recorded_by: req.user.id, notes: b.notes,
    }], { session })
    await audit(req, 'payment.record', 'payment', row._id, { studentId: b.studentId, amountKobo: b.amountKobo, method: b.method, receipt }, session)
    return row.toObject()
  })
  defer(() => emailReceipt(payment._id))
  res.status(201).json(payment)
})

finance.get('/payments/:id/receipt.pdf', async (req, res) => {
  const payment = await Payment.findOne({ _id: idParam(req), status: { $in: ['success', 'refunded'] } }).lean()
  if (!payment) throw notFoundError('Receipt not found')
  const student = await studentForReceipt(payment.student_id)
  const { balanceKobo } = await accountSummary(payment.student_id)
  pdf(res, `${payment.receipt_number}.pdf`, await receiptPdf({ payment, student: { ...student, balance_kobo: balanceKobo } }))
})

finance.get('/payments/:id/proof', async (req, res) => {
  const p = await Payment.findById(idParam(req), 'proof_file_id').lean()
  if (!p?.proof_file_id) throw notFoundError('No proof uploaded')
  await sendFile(res, p.proof_file_id)
})

finance.post('/payments/:id/refund', async (req, res) => {
  const { reason } = parse(z.object({ reason: requiredText(500) }), req.body)
  const row = await Payment.findOneAndUpdate(
    { _id: idParam(req), status: 'success' },
    { $set: { status: 'refunded', refunded_at: new Date(), refund_reason: reason } },
    { returnDocument: 'after' },
  ).lean()
  if (!row) throw badRequest('Only successful payments can be refunded')
  await audit(req, 'payment.refund', 'payment', row._id, { reason, amountKobo: row.amount_kobo })
  res.json(row)
})

// Re-checks a pending online payment with Paystack (e.g. student closed the tab before returning).
finance.post('/payments/:id/verify', async (req, res) => {
  const p = await Payment.findOne({ _id: idParam(req), gateway: 'paystack' }, 'reference').lean()
  if (!p) throw notFoundError('Online payment not found')
  const data = await verifyTransaction(p.reference)
  const result = await withTransaction((session) => settleGatewayPayment(session, p.reference, data))
  if (result?.newlySettled) defer(() => emailReceipt(result.payment._id))
  res.json(result.payment)
})

// ── Debtors & reminders ──────────────────────────────────────────────────────

async function debtors(cohortId) {
  const students = await Student.find({ status: { $in: ['active', 'suspended'] }, ...(cohortId ? { cohort_id: cohortId } : {}) }).lean()
  if (!students.length) return []
  const ids = students.map((s) => s._id)
  const [inv, pay, users, cohorts, programmes] = await Promise.all([
    Invoice.aggregate([
      { $match: { student_id: { $in: ids }, voided_at: null } },
      {
        $group: {
          _id: '$student_id',
          net: { $sum: { $cond: [{ $eq: ['$kind', 'charge'] }, '$amount_kobo', { $multiply: ['$amount_kobo', -1] }] } },
          earliest: { $min: { $cond: [{ $eq: ['$kind', 'charge'] }, '$due_date', null] } },
        },
      },
    ]),
    Payment.aggregate([{ $match: { student_id: { $in: ids }, status: 'success' } }, { $group: { _id: '$student_id', paid: { $sum: '$amount_kobo' } } }]),
    byIds(User, students.map((s) => s.user_id), 'email'),
    byIds(Cohort, students.map((s) => s.cohort_id), 'name'),
    byIds(Programme, students.map((s) => s.programme_id), 'name'),
  ])
  const invBy = new Map(inv.map((r) => [String(r._id), r]))
  const paidBy = new Map(pay.map((r) => [String(r._id), r.paid]))
  return students
    .map((s) => {
      const i = invBy.get(String(s._id))
      return {
        id: String(s._id), student_number: s.student_number, first_name: s.first_name, last_name: s.last_name, phone: s.phone,
        email: pick(users, s.user_id, 'email') ?? s.email, cohort_name: pick(cohorts, s.cohort_id, 'name'), programme_name: pick(programmes, s.programme_id, 'name'),
        balance_kobo: (i?.net ?? 0) - (paidBy.get(String(s._id)) ?? 0), earliest_due: i?.earliest ?? null,
      }
    })
    .filter((d) => d.balance_kobo > 0)
    .sort((a, b) => b.balance_kobo - a.balance_kobo)
}

finance.get('/debtors', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: optionalId }), req.query)
  const rows = await debtors(cohortId)
  res.json({ rows, totalKobo: rows.reduce((s, r) => s + r.balance_kobo, 0) })
})

finance.get('/debtors.csv', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: optionalId }), req.query)
  sendCsv(res, 'debtors.csv', await debtors(cohortId), [
    { key: 'student_number', label: 'Student ID' }, { label: 'Name', value: (r) => `${r.first_name} ${r.last_name}` },
    { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'programme_name', label: 'Programme' }, { key: 'cohort_name', label: 'Cohort' },
    { label: 'Balance (NGN)', value: (r) => (r.balance_kobo / 100).toFixed(2) }, { key: 'earliest_due', label: 'Earliest due' },
  ])
})

finance.post('/reminders', async (req, res) => {
  const b = parse(z.object({ cohortId: optionalId, studentIds: z.array(id).max(2000).optional(), overdueOnly: z.boolean().default(false) }), req.body)
  let rows = await debtors(b.cohortId)
  if (b.studentIds?.length) rows = rows.filter((r) => b.studentIds.includes(r.id))
  const messages = []
  for (const r of rows) {
    if (!r.email) continue
    const schedule = await instalmentSchedule(r.id)
    const overdue = schedule.filter((s) => s.status === 'overdue')
    if (b.overdueOnly && !overdue.length) continue
    const next = schedule.find((s) => s.outstanding_kobo > 0)
    messages.push({
      to: r.email,
      subject: overdue.length ? 'Fee payment overdue' : 'Fee payment reminder',
      html: layout({
        heading: overdue.length ? 'Your fee payment is overdue' : 'Friendly fee reminder',
        paragraphs: [
          `Hello ${r.first_name}, your outstanding balance is ${formatKobo(r.balance_kobo)}.`,
          next?.due_date ? `${next.description}: ${formatKobo(next.outstanding_kobo)} due ${next.due_date}.` : '',
          'You can pay online by card, bank transfer or USSD in the student portal, or at the academy office.',
        ].filter(Boolean),
        action: { label: 'Pay now', url: `${config.webUrl}/portal/payments` },
      }),
    })
  }
  defer(async () => {
    for (const m of messages) await sendMail({ ...m, sentBy: req.user.id })
  })
  await audit(req, 'finance.reminders', 'finance', null, { sent: messages.length, cohortId: b.cohortId })
  res.json({ sent: messages.length })
})

// ── Reports (spec §9.4 "daily, weekly, monthly income, by programme and by payment method") ──

const reportSchema = z.object({ from: dateStr, to: dateStr, groupBy: z.enum(['day', 'week', 'month', 'programme', 'method', 'category']).default('day') })

async function incomeReport({ from, to, groupBy }) {
  const tz = 'Africa/Lagos'
  const payments = await Payment.aggregate([
    { $match: { status: 'success', paid_at: { $ne: null } } },
    { $addFields: { day: { $dateToString: { format: '%Y-%m-%d', date: '$paid_at', timezone: tz } } } },
    { $match: { day: { $gte: from, $lte: to } } },
    {
      $addFields: {
        week: { $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: '$paid_at', unit: 'week', startOfWeek: 'monday', timezone: tz } }, timezone: tz } },
        month: { $dateToString: { format: '%Y-%m', date: '$paid_at', timezone: tz } },
      },
    },
  ])
  let keyOf
  if (['day', 'week', 'month'].includes(groupBy)) keyOf = (p) => p[groupBy]
  else if (groupBy === 'method') keyOf = (p) => p.method
  else if (groupBy === 'programme') {
    const students = await byIds(Student, payments.map((p) => p.student_id), 'programme_id')
    const programmes = await byIds(Programme, [...students.values()].map((s) => s.programme_id), 'name')
    keyOf = (p) => pick(programmes, students.get(String(p.student_id))?.programme_id, 'name') ?? 'Unassigned'
  } else {
    const invoices = await byIds(Invoice, payments.map((p) => p.invoice_id), 'category')
    keyOf = (p) => pick(invoices, p.invoice_id, 'category') ?? 'unallocated'
  }
  const groups = new Map()
  for (const p of payments) {
    const k = keyOf(p)
    const g = groups.get(k) ?? { label: k, payments: 0, total_kobo: 0 }
    g.payments++
    g.total_kobo += p.amount_kobo
    groups.set(k, g)
  }
  const rows = [...groups.values()].sort(['day', 'week', 'month'].includes(groupBy) ? (a, b) => a.label.localeCompare(b.label) : (a, b) => b.total_kobo - a.total_kobo)
  return { from, to, groupBy, rows, totalKobo: rows.reduce((s, r) => s + r.total_kobo, 0) }
}

finance.get('/report', async (req, res) => res.json(await incomeReport(parse(reportSchema, req.query))))

finance.get('/report.csv', async (req, res) => {
  const r = await incomeReport(parse(reportSchema, req.query))
  sendCsv(res, `income-${r.groupBy}-${r.from}-to-${r.to}.csv`, r.rows, [
    { key: 'label', label: r.groupBy }, { key: 'payments', label: 'Payments' }, { label: 'Total (NGN)', value: (x) => (x.total_kobo / 100).toFixed(2) },
  ])
})

// ── Sponsor invoices ─────────────────────────────────────────────────────────

finance.get('/sponsor-invoices', async (req, res) => {
  const rows = await SponsorInvoice.find().sort({ issued_on: -1, _id: -1 }).lean()
  const cohorts = await byIds(Cohort, rows.map((r) => r.cohort_id), 'name')
  res.json(rows.map((r) => ({ ...r, cohort_name: pick(cohorts, r.cohort_id, 'name') })))
})

finance.post('/sponsor-invoices', async (req, res) => {
  const b = parse(z.object({
    cohortId: optionalId,
    sponsorName: requiredText(160),
    sponsorEmail: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('').transform(() => null)),
    description: requiredText(500),
    amountKobo: z.coerce.number().int().positive(),
    dueDate: optionalDate,
  }), req.body)
  const row = await SponsorInvoice.create({
    invoice_number: await nextSponsorInvoiceNumber(), cohort_id: b.cohortId, sponsor_name: b.sponsorName, sponsor_email: b.sponsorEmail ?? null,
    description: b.description, amount_kobo: b.amountKobo, due_date: b.dueDate ?? null, created_by: req.user.id,
  })
  await audit(req, 'sponsor_invoice.create', 'sponsor_invoice', row._id, b)
  res.status(201).json(row)
})

finance.patch('/sponsor-invoices/:id', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['unpaid', 'paid', 'cancelled']) }), req.body)
  const row = await SponsorInvoice.findByIdAndUpdate(
    idParam(req),
    { $set: { status, paid_on: status === 'paid' ? new Date().toISOString().slice(0, 10) : null } },
    { returnDocument: 'after' },
  ).lean()
  if (!row) throw notFoundError()
  await audit(req, 'sponsor_invoice.status', 'sponsor_invoice', row._id, { status })
  res.json(row)
})

finance.get('/sponsor-invoices/:id/pdf', async (req, res) => {
  const inv = await SponsorInvoice.findById(idParam(req)).lean()
  if (!inv) throw notFoundError()
  let cohort = null
  if (inv.cohort_id) {
    const c = await Cohort.findById(inv.cohort_id, 'name programme_id').lean()
    if (c) cohort = { name: c.name, programme_name: (await Programme.findById(c.programme_id, 'name').lean())?.name }
  }
  pdf(res, `${inv.invoice_number}.pdf`, await sponsorInvoicePdf({ invoice: inv, cohort }))
})

