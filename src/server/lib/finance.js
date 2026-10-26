// Account balance and payment-recording logic shared by the student portal, admin and webhook.
import { Invoice, Payment, Student, Programme, User } from '../db/models.js'
import { oid } from '../db/mongo.js'
import { formatKobo } from './money.js'
import { receiptPdf } from './pdf.js'
import { sendMail, layout } from './mailer.js'
import { nextReceiptNumber } from './sequence.js'
import { config } from '../config.js'

const today = () => new Date().toISOString().slice(0, 10)

/** Balance = charges − (discounts + scholarships + sponsor credits) − successful payments. */
export async function accountSummary(studentId, session) {
  const sid = oid(studentId)
  const [inv, paid] = await Promise.all([
    Invoice.aggregate([
      { $match: { student_id: sid, voided_at: null } },
      {
        $group: {
          _id: null,
          charges: { $sum: { $cond: [{ $eq: ['$kind', 'charge'] }, '$amount_kobo', 0] } },
          credits: { $sum: { $cond: [{ $ne: ['$kind', 'charge'] }, '$amount_kobo', 0] } },
          nextDue: { $min: { $cond: [{ $and: [{ $eq: ['$kind', 'charge'] }, { $gte: ['$due_date', today()] }] }, '$due_date', null] } },
        },
      },
    ]).session(session ?? null),
    Payment.aggregate([
      { $match: { student_id: sid, status: 'success' } },
      { $group: { _id: null, paid: { $sum: '$amount_kobo' } } },
    ]).session(session ?? null),
  ])
  const charges = inv[0]?.charges ?? 0
  const credits = inv[0]?.credits ?? 0
  const paidKobo = paid[0]?.paid ?? 0
  return { chargesKobo: charges, creditsKobo: credits, paidKobo, balanceKobo: charges - credits - paidKobo, nextDue: inv[0]?.nextDue ?? null }
}

/** Instalment schedule: each charge's outstanding portion, allocating payments + credits oldest-due first. */
export async function instalmentSchedule(studentId) {
  const charges = await Invoice.find({ student_id: studentId, voided_at: null, kind: 'charge' }).lean()
  charges.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || String(a._id).localeCompare(String(b._id)))
  const { creditsKobo, paidKobo } = await accountSummary(studentId)
  let pool = creditsKobo + paidKobo
  return charges.map((c) => {
    const applied = Math.min(pool, c.amount_kobo)
    pool -= applied
    const outstanding = c.amount_kobo - applied
    const overdue = outstanding > 0 && c.due_date && c.due_date < today()
    return {
      id: String(c._id), description: c.description, category: c.category, amount_kobo: c.amount_kobo, due_date: c.due_date,
      paid_kobo: applied, outstanding_kobo: outstanding, status: outstanding === 0 ? 'paid' : overdue ? 'overdue' : applied > 0 ? 'part_paid' : 'due',
    }
  })
}

export { nextReceiptNumber }

/** Student with programme name and login email, for receipts. */
export async function studentForReceipt(studentId) {
  const s = await Student.findById(studentId).lean()
  if (!s) return null
  const [programme, user] = await Promise.all([
    s.programme_id ? Programme.findById(s.programme_id, 'name').lean() : null,
    s.user_id ? User.findById(s.user_id, 'email').lean() : null,
  ])
  return { ...s, id: String(s._id), programme_name: programme?.name ?? null, user_email: user?.email ?? null }
}

/** Emails the PDF receipt for a successful payment (best-effort). */
export async function emailReceipt(paymentId) {
  const payment = await Payment.findById(paymentId).lean()
  if (!payment || payment.status !== 'success') return
  const student = await studentForReceipt(payment.student_id)
  const to = student?.user_email ?? student?.email
  if (!to) return
  const { balanceKobo } = await accountSummary(payment.student_id)
  const pdf = await receiptPdf({ payment, student: { ...student, balance_kobo: balanceKobo } })
  await sendMail({
    to,
    subject: `Payment received — ${formatKobo(payment.amount_kobo)} (${payment.receipt_number})`,
    html: layout({
      heading: 'Thank you — payment received',
      paragraphs: [
        `Hello ${student.first_name}, we have received your payment of ${formatKobo(payment.amount_kobo)} for ${payment.purpose}.`,
        `Receipt number: ${payment.receipt_number}. Outstanding balance: ${formatKobo(Math.max(0, balanceKobo))}.`,
        'Your receipt is attached and is also available in the student portal.',
      ],
      action: { label: 'Open student portal', url: `${config.webUrl}/portal/payments` },
    }),
    attachments: [{ filename: `${payment.receipt_number}.pdf`, content: pdf }],
  })
}

/**
 * Marks a gateway payment as successful exactly once (idempotent across callback + webhook).
 * Must run inside a transaction. Returns { payment, newlySettled }, or null if the reference is unknown.
 */
export async function settleGatewayPayment(session, reference, gatewayData) {
  const payment = await Payment.findOne({ reference }).session(session).lean()
  if (!payment) return null
  if (payment.status === 'success') return { payment, newlySettled: false }
  const update = (set) => Payment.findOneAndUpdate({ _id: payment._id, status: { $ne: 'success' } }, { $set: set }, { returnDocument: 'after', session }).lean()

  if (gatewayData.status !== 'success') {
    const failed = await update({ status: gatewayData.status === 'abandoned' ? 'cancelled' : 'failed', gateway_response: gatewayData })
    return { payment: failed ?? payment, newlySettled: false }
  }
  if (Number(gatewayData.amount) !== Number(payment.amount_kobo) || gatewayData.currency !== 'NGN') {
    // Amount mismatch: never credit more or less than the gateway actually charged.
    const flagged = await update({ status: 'failed', gateway_response: gatewayData, notes: 'Amount/currency mismatch — review manually' })
    return { payment: flagged ?? payment, newlySettled: false }
  }
  const settled = await update({
    status: 'success',
    paid_at: gatewayData.paid_at ? new Date(gatewayData.paid_at) : new Date(),
    receipt_number: await nextReceiptNumber(session),
    method: gatewayData.channel === 'bank_transfer' ? 'transfer' : gatewayData.channel ?? 'card',
    gateway_response: gatewayData,
  })
  if (!settled) return { payment: await Payment.findById(payment._id).session(session).lean(), newlySettled: false }
  return { payment: settled, newlySettled: true }
}
