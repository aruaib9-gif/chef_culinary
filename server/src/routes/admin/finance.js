// Finance: charges/credits, manual & online payments, receipts, refunds, debtors, reminders,
// sponsor invoices and income reports (spec §9.4, §10). Super admin only.
import { Router } from 'express'
import { z } from 'zod'
import { many, one, tx, db } from '../../db/pool.js'
import { config } from '../../config.js'
import { parse, idParam, id, optionalId, pagination, paged, requiredText, optionalText, optionalDate, dateStr } from '../../lib/validate.js'
import { upload, storeFile, sendFile } from '../../lib/files.js'
import { sendCsv } from '../../lib/csv.js'
import { audit } from '../../lib/audit.js'
import { formatKobo } from '../../lib/money.js'
import { accountSummary, instalmentSchedule, nextReceiptNumber, emailReceipt, studentForReceipt, settleGatewayPayment } from '../../lib/finance.js'
import { verifyTransaction } from '../../lib/paystack.js'
import { receiptPdf, sponsorInvoicePdf } from '../../lib/pdf.js'
import { sendMail, layout } from '../../lib/mailer.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { badRequest, notFoundError } from '../../middleware/errors.js'

export const finance = Router()
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
  const student = await studentForReceipt(db, sid)
  if (!student) throw notFoundError('Student not found')
  const [account, schedule, invoices, payments] = await Promise.all([
    accountSummary(db, sid),
    instalmentSchedule(db, sid),
    many(`SELECT i.*, u.full_name AS created_by_name FROM invoices i LEFT JOIN users u ON u.id = i.created_by WHERE i.student_id = $1 ORDER BY i.created_at`, [sid]),
    many(`SELECT p.*, u.full_name AS recorded_by_name FROM payments p LEFT JOIN users u ON u.id = p.recorded_by WHERE p.student_id = $1 ORDER BY p.created_at DESC`, [sid]),
  ])
  res.json({ student, account, schedule, invoices, payments })
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
  const s = await one('SELECT cohort_id FROM students WHERE id = $1', [b.studentId])
  if (!s) throw notFoundError('Student not found')
  const row = await one(
    `INSERT INTO invoices (student_id, cohort_id, description, category, kind, amount_kobo, due_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [b.studentId, s.cohort_id, b.description, b.category, b.kind, b.amountKobo, b.dueDate ?? null, req.user.id],
  )
  await audit(req, `invoice.${b.kind}`, 'invoice', row.id, b)
  res.status(201).json(row)
})

// Charge every active student in a cohort (e.g. uniform or project fee).
finance.post('/invoices/bulk', async (req, res) => {
  const b = parse(invoiceSchema.omit({ studentId: true }).extend({ cohortId: id }), req.body)
  const { rows } = await db.query(
    `INSERT INTO invoices (student_id, cohort_id, description, category, kind, amount_kobo, due_date, created_by)
     SELECT id, $1, $2, $3, $4, $5, $6, $7 FROM students WHERE cohort_id = $1 AND status = 'active' RETURNING id`,
    [b.cohortId, b.description, b.category, b.kind, b.amountKobo, b.dueDate ?? null, req.user.id],
  )
  await audit(req, 'invoice.bulk', 'cohort', b.cohortId, { ...b, count: rows.length })
  res.status(201).json({ created: rows.length })
})

finance.post('/invoices/:id/void', async (req, res) => {
  const { reason } = parse(z.object({ reason: requiredText(500) }), req.body)
  const row = await one('UPDATE invoices SET voided_at = now(), void_reason = $2 WHERE id = $1 AND voided_at IS NULL RETURNING *', [idParam(req), reason])
  if (!row) throw notFoundError('Invoice not found or already voided')
  await audit(req, 'invoice.void', 'invoice', row.id, { reason })
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

function paymentWhere(f) {
  const params = []
  const c = []
  if (f.status) c.push(`p.status = $${params.push(f.status)}`)
  if (f.method) c.push(`p.method = $${params.push(f.method)}`)
  if (f.from) c.push(`COALESCE(p.paid_at, p.created_at) >= $${params.push(f.from)}::date`)
  if (f.to) c.push(`COALESCE(p.paid_at, p.created_at) < $${params.push(f.to)}::date + 1`)
  if (f.programmeId) c.push(`s.programme_id = $${params.push(f.programmeId)}`)
  if (f.q) {
    params.push(`%${f.q}%`)
    c.push(`(s.first_name || ' ' || s.last_name ILIKE $${params.length} OR s.student_number ILIKE $${params.length} OR p.reference ILIKE $${params.length} OR p.receipt_number ILIKE $${params.length})`)
  }
  return { where: c.length ? `WHERE ${c.join(' AND ')}` : '', params }
}

const PAYMENT_SELECT = `
  SELECT p.*, s.student_number, s.first_name, s.last_name, pr.name AS programme_name, u.full_name AS recorded_by_name
    FROM payments p JOIN students s ON s.id = p.student_id
    LEFT JOIN programmes pr ON pr.id = s.programme_id LEFT JOIN users u ON u.id = p.recorded_by`

finance.get('/payments', async (req, res) => {
  const f = parse(paymentFilters, req.query)
  const { where, params } = paymentWhere(f)
  const rows = await many(
    `SELECT x.*, COUNT(*) OVER() AS total_count FROM (${PAYMENT_SELECT} ${where}) x
      ORDER BY COALESCE(x.paid_at, x.created_at) DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
    params,
  )
  const totals = await one(`SELECT COALESCE(SUM(p.amount_kobo) FILTER (WHERE p.status = 'success'), 0) AS received FROM payments p JOIN students s ON s.id = p.student_id ${where}`, params)
  res.json({ ...paged(rows, f), receivedKobo: Number(totals.received) })
})

finance.get('/payments/export.csv', async (req, res) => {
  const f = parse(paymentFilters, req.query)
  const { where, params } = paymentWhere(f)
  const rows = await many(`${PAYMENT_SELECT} ${where} ORDER BY COALESCE(p.paid_at, p.created_at) DESC`, params)
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
})

// Cash / bank deposit recorded by the office, with optional proof of payment (spec §10 "Offline payments").
finance.post('/payments', upload.single('proof'), async (req, res) => {
  const b = parse(manualSchema, req.body)
  const payment = await tx(async (t) => {
    const s = await t.one('SELECT id FROM students WHERE id = $1', [b.studentId])
    if (!s) throw notFoundError('Student not found')
    const proof = req.file ? await storeFile(t, req.file, req.user.id) : null
    const receipt = await nextReceiptNumber(t)
    const row = await t.one(
      `INSERT INTO payments (student_id, invoice_id, amount_kobo, purpose, method, reference, status, paid_at, receipt_number, gateway, proof_file_id, recorded_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,'success', COALESCE($7::date::timestamptz, now()), $8, 'manual', $9, $10, $11) RETURNING *`,
      [b.studentId, b.invoiceId, b.amountKobo, b.purpose, b.method, b.reference || receipt, b.paidAt ?? null, receipt, proof?.id ?? null, req.user.id, b.notes],
    )
    await audit(req, 'payment.record', 'payment', row.id, { studentId: b.studentId, amountKobo: b.amountKobo, method: b.method, receipt }, t)
    return row
  })
  emailReceipt(db, payment.id).catch((e) => console.error(e))
  res.status(201).json(payment)
})

finance.get('/payments/:id/receipt.pdf', async (req, res) => {
  const payment = await one(`SELECT * FROM payments WHERE id = $1 AND status IN ('success', 'refunded')`, [idParam(req)])
  if (!payment) throw notFoundError('Receipt not found')
  const student = await studentForReceipt(db, payment.student_id)
  const { balanceKobo } = await accountSummary(db, payment.student_id)
  pdf(res, `${payment.receipt_number}.pdf`, await receiptPdf({ payment, student: { ...student, balance_kobo: balanceKobo } }))
})

finance.get('/payments/:id/proof', async (req, res) => {
  const p = await one('SELECT proof_file_id FROM payments WHERE id = $1', [idParam(req)])
  if (!p?.proof_file_id) throw notFoundError('No proof uploaded')
  await sendFile(res, db, p.proof_file_id)
})

finance.post('/payments/:id/refund', async (req, res) => {
  const { reason } = parse(z.object({ reason: requiredText(500) }), req.body)
  const row = await one(
    `UPDATE payments SET status = 'refunded', refunded_at = now(), refund_reason = $2 WHERE id = $1 AND status = 'success' RETURNING *`,
    [idParam(req), reason],
  )
  if (!row) throw badRequest('Only successful payments can be refunded')
  await audit(req, 'payment.refund', 'payment', row.id, { reason, amountKobo: row.amount_kobo })
  res.json(row)
})

// Re-checks a pending online payment with Paystack (e.g. student closed the tab before returning).
finance.post('/payments/:id/verify', async (req, res) => {
  const p = await one(`SELECT reference FROM payments WHERE id = $1 AND gateway = 'paystack'`, [idParam(req)])
  if (!p) throw notFoundError('Online payment not found')
  const data = await verifyTransaction(p.reference)
  const result = await tx((t) => settleGatewayPayment(t, p.reference, data))
  if (result?.newlySettled) emailReceipt(db, result.payment.id).catch((e) => console.error(e))
  res.json(result.payment)
})

// ── Debtors & reminders ──────────────────────────────────────────────────────

const DEBTORS_SQL = `
  SELECT * FROM (
    SELECT s.id, s.student_number, s.first_name, s.last_name, s.phone, COALESCE(u.email, s.email) AS email,
           c.name AS cohort_name, p.name AS programme_name,
           COALESCE((SELECT SUM(amount_kobo) FROM invoices WHERE student_id = s.id AND voided_at IS NULL AND kind = 'charge'), 0)
             - COALESCE((SELECT SUM(amount_kobo) FROM invoices WHERE student_id = s.id AND voided_at IS NULL AND kind <> 'charge'), 0)
             - COALESCE((SELECT SUM(amount_kobo) FROM payments WHERE student_id = s.id AND status = 'success'), 0) AS balance_kobo,
           (SELECT MIN(due_date) FROM invoices WHERE student_id = s.id AND voided_at IS NULL AND kind = 'charge') AS earliest_due
      FROM students s LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN cohorts c ON c.id = s.cohort_id LEFT JOIN programmes p ON p.id = s.programme_id
     WHERE s.status IN ('active', 'suspended') AND ($1::bigint IS NULL OR s.cohort_id = $1)
  ) d WHERE balance_kobo > 0`

finance.get('/debtors', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: optionalId }), req.query)
  const rows = await many(`${DEBTORS_SQL} ORDER BY balance_kobo DESC`, [cohortId])
  res.json({ rows, totalKobo: rows.reduce((s, r) => s + r.balance_kobo, 0) })
})

finance.get('/debtors.csv', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: optionalId }), req.query)
  const rows = await many(`${DEBTORS_SQL} ORDER BY balance_kobo DESC`, [cohortId])
  sendCsv(res, 'debtors.csv', rows, [
    { key: 'student_number', label: 'Student ID' }, { label: 'Name', value: (r) => `${r.first_name} ${r.last_name}` },
    { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'programme_name', label: 'Programme' }, { key: 'cohort_name', label: 'Cohort' },
    { label: 'Balance (NGN)', value: (r) => (r.balance_kobo / 100).toFixed(2) }, { key: 'earliest_due', label: 'Earliest due' },
  ])
})

finance.post('/reminders', async (req, res) => {
  const b = parse(z.object({ cohortId: optionalId, studentIds: z.array(id).max(2000).optional(), overdueOnly: z.boolean().default(false) }), req.body)
  let rows = await many(DEBTORS_SQL, [b.cohortId])
  if (b.studentIds?.length) rows = rows.filter((r) => b.studentIds.includes(r.id))
  let sent = 0
  for (const r of rows) {
    const schedule = await instalmentSchedule(db, r.id)
    const overdue = schedule.filter((s) => s.status === 'overdue')
    if (b.overdueOnly && !overdue.length) continue
    if (!r.email) continue
    const next = schedule.find((s) => s.outstanding_kobo > 0)
    sendMail({
      to: r.email,
      sentBy: req.user.id,
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
    sent++
  }
  await audit(req, 'finance.reminders', 'finance', null, { sent, cohortId: b.cohortId })
  res.json({ sent })
})

// ── Reports (spec §9.4 "daily, weekly, monthly income, by programme and by payment method") ──

const reportSchema = z.object({ from: dateStr, to: dateStr, groupBy: z.enum(['day', 'week', 'month', 'programme', 'method', 'category']).default('day') })

async function incomeReport({ from, to, groupBy }) {
  const key = {
    day: `to_char(date_trunc('day', p.paid_at AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM-DD')`,
    week: `to_char(date_trunc('week', p.paid_at AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM-DD')`,
    month: `to_char(date_trunc('month', p.paid_at AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM')`,
    programme: `COALESCE(pr.name, 'Unassigned')`,
    method: 'p.method',
    category: `COALESCE(i.category, 'unallocated')`,
  }[groupBy]
  const rows = await many(
    `SELECT ${key} AS label, COUNT(*)::int AS payments, SUM(p.amount_kobo) AS total_kobo
       FROM payments p JOIN students s ON s.id = p.student_id
       LEFT JOIN programmes pr ON pr.id = s.programme_id LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.status = 'success' AND (p.paid_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY ${['day', 'week', 'month'].includes(groupBy) ? '1' : 'total_kobo DESC'}`,
    [from, to],
  )
  return { from, to, groupBy, rows, totalKobo: rows.reduce((s, r) => s + Number(r.total_kobo), 0) }
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
  res.json(await many(`SELECT si.*, c.name AS cohort_name FROM sponsor_invoices si LEFT JOIN cohorts c ON c.id = si.cohort_id ORDER BY si.issued_on DESC, si.id DESC`))
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
  const row = await tx(async (t) => {
    const { n } = await t.one(`SELECT nextval('sponsor_invoice_seq') AS n`)
    return t.one(
      `INSERT INTO sponsor_invoices (invoice_number, cohort_id, sponsor_name, sponsor_email, description, amount_kobo, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [`INV-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`, b.cohortId, b.sponsorName, b.sponsorEmail ?? null, b.description, b.amountKobo, b.dueDate ?? null, req.user.id],
    )
  })
  await audit(req, 'sponsor_invoice.create', 'sponsor_invoice', row.id, b)
  res.status(201).json(row)
})

finance.patch('/sponsor-invoices/:id', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['unpaid', 'paid', 'cancelled']) }), req.body)
  const row = await one(
    `UPDATE sponsor_invoices SET status = $2, paid_on = CASE WHEN $2 = 'paid' THEN CURRENT_DATE ELSE NULL END WHERE id = $1 RETURNING *`,
    [idParam(req), status],
  )
  if (!row) throw notFoundError()
  await audit(req, 'sponsor_invoice.status', 'sponsor_invoice', row.id, { status })
  res.json(row)
})

finance.get('/sponsor-invoices/:id/pdf', async (req, res) => {
  const inv = await one('SELECT * FROM sponsor_invoices WHERE id = $1', [idParam(req)])
  if (!inv) throw notFoundError()
  const cohort = inv.cohort_id ? await one('SELECT c.name, p.name AS programme_name FROM cohorts c JOIN programmes p ON p.id = c.programme_id WHERE c.id = $1', [inv.cohort_id]) : null
  pdf(res, `${inv.invoice_number}.pdf`, await sponsorInvoicePdf({ invoice: inv, cohort }))
})
