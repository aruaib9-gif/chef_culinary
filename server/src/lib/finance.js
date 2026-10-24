// Account balance and payment-recording logic shared by the student portal, admin and webhook.
import { formatKobo } from './money.js'
import { receiptPdf } from './pdf.js'
import { sendMail, layout } from './mailer.js'
import { config } from '../config.js'

export async function accountSummary(db, studentId) {
  const s = await db.one(
    `SELECT
       COALESCE((SELECT SUM(amount_kobo) FROM invoices WHERE student_id = $1 AND voided_at IS NULL AND kind = 'charge'), 0) AS charges,
       COALESCE((SELECT SUM(amount_kobo) FROM invoices WHERE student_id = $1 AND voided_at IS NULL AND kind <> 'charge'), 0) AS credits,
       COALESCE((SELECT SUM(amount_kobo) FROM payments WHERE student_id = $1 AND status = 'success'), 0) AS paid,
       (SELECT MIN(due_date) FROM invoices WHERE student_id = $1 AND voided_at IS NULL AND kind = 'charge' AND due_date >= CURRENT_DATE) AS next_due`,
    [studentId],
  )
  const charges = Number(s.charges)
  const credits = Number(s.credits)
  const paid = Number(s.paid)
  return { chargesKobo: charges, creditsKobo: credits, paidKobo: paid, balanceKobo: charges - credits - paid, nextDue: s.next_due }
}

// Instalment schedule: each charge's outstanding portion, allocating payments + credits oldest-due first.
export async function instalmentSchedule(db, studentId) {
  const charges = await db.many(
    `SELECT id, description, category, amount_kobo, due_date FROM invoices
      WHERE student_id = $1 AND voided_at IS NULL AND kind = 'charge'
      ORDER BY due_date NULLS LAST, id`,
    [studentId],
  )
  const { creditsKobo, paidKobo } = await accountSummary(db, studentId)
  let pool = creditsKobo + paidKobo
  return charges.map((c) => {
    const applied = Math.min(pool, c.amount_kobo)
    pool -= applied
    const outstanding = c.amount_kobo - applied
    const overdue = outstanding > 0 && c.due_date && c.due_date < new Date().toISOString().slice(0, 10)
    return { ...c, paid_kobo: applied, outstanding_kobo: outstanding, status: outstanding === 0 ? 'paid' : overdue ? 'overdue' : applied > 0 ? 'part_paid' : 'due' }
  })
}

export async function nextReceiptNumber(db) {
  const { n } = await db.one(`SELECT nextval('receipt_number_seq') AS n`)
  return `RCT-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`
}

export async function studentForReceipt(db, studentId) {
  return db.one(
    `SELECT s.*, p.name AS programme_name, u.email AS user_email
       FROM students s LEFT JOIN programmes p ON p.id = s.programme_id LEFT JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [studentId],
  )
}

/** Emails the PDF receipt for a successful payment (best-effort). */
export async function emailReceipt(db, paymentId) {
  const payment = await db.one('SELECT * FROM payments WHERE id = $1', [paymentId])
  if (!payment || payment.status !== 'success') return
  const student = await studentForReceipt(db, payment.student_id)
  const to = student?.user_email ?? student?.email
  if (!to) return
  const { balanceKobo } = await accountSummary(db, payment.student_id)
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
 * Returns the payment row, or null if the reference is unknown.
 */
export async function settleGatewayPayment(txdb, reference, gatewayData) {
  const payment = await txdb.one('SELECT * FROM payments WHERE reference = $1 FOR UPDATE', [reference])
  if (!payment) return null
  if (payment.status === 'success') return { payment, newlySettled: false }
  if (gatewayData.status !== 'success') {
    const failed = await txdb.one(
      `UPDATE payments SET status = CASE WHEN $2 = 'abandoned' THEN 'cancelled' ELSE 'failed' END, gateway_response = $3 WHERE id = $1 RETURNING *`,
      [payment.id, gatewayData.status, gatewayData],
    )
    return { payment: failed, newlySettled: false }
  }
  if (Number(gatewayData.amount) !== Number(payment.amount_kobo) || gatewayData.currency !== 'NGN') {
    // Amount mismatch: never credit more or less than the gateway actually charged.
    const flagged = await txdb.one(
      `UPDATE payments SET status = 'failed', gateway_response = $2, notes = 'Amount/currency mismatch — review manually' WHERE id = $1 RETURNING *`,
      [payment.id, gatewayData],
    )
    return { payment: flagged, newlySettled: false }
  }
  const receipt = await nextReceiptNumber(txdb)
  const settled = await txdb.one(
    `UPDATE payments SET status = 'success', paid_at = COALESCE($2::timestamptz, now()), receipt_number = $3,
            method = $4, gateway_response = $5
      WHERE id = $1 RETURNING *`,
    [payment.id, gatewayData.paid_at ?? null, receipt, gatewayData.channel === 'bank_transfer' ? 'transfer' : gatewayData.channel ?? 'card', gatewayData],
  )
  return { payment: settled, newlySettled: true }
}
