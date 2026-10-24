// Daily automation (Render cron job): fee reminders before/after due dates, lead follow-ups, housekeeping.
// Spec §6.2 "Follow-up automation" and §10 "Payment reminders".
import { many, query, pool, db } from '../db/pool.js'
import { config } from '../config.js'
import { instalmentSchedule } from '../lib/finance.js'
import { formatKobo } from '../lib/money.js'
import { sendMail, layout } from '../lib/mailer.js'

const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
const iso = (d) => d.toISOString().slice(0, 10)
const shift = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return iso(d) }

async function feeReminders() {
  // Remind 3 days before a due date, and 1, 7 and 14 days after it if still unpaid.
  const targets = { [shift(3)]: 'upcoming', [shift(-1)]: 'overdue', [shift(-7)]: 'overdue', [shift(-14)]: 'overdue' }
  const students = await many(
    `SELECT DISTINCT s.id, s.first_name, COALESCE(u.email, s.email) AS email
       FROM invoices i JOIN students s ON s.id = i.student_id LEFT JOIN users u ON u.id = s.user_id
      WHERE i.kind = 'charge' AND i.voided_at IS NULL AND i.due_date = ANY($1::date[]) AND s.status = 'active'`,
    [Object.keys(targets)],
  )
  let sent = 0
  for (const s of students) {
    if (!s.email) continue
    const item = (await instalmentSchedule(db, s.id)).find((x) => x.outstanding_kobo > 0 && targets[x.due_date])
    if (!item) continue
    const overdue = targets[item.due_date] === 'overdue'
    await sendMail({
      to: s.email,
      subject: overdue ? `Overdue: ${item.description}` : `Payment due soon: ${item.description}`,
      html: layout({
        heading: overdue ? 'Your payment is overdue' : 'Your next payment is due soon',
        paragraphs: [
          `Hello ${s.first_name}, ${item.description} — ${formatKobo(item.outstanding_kobo)} — ${overdue ? 'was due' : 'is due'} on ${item.due_date}.`,
          'Pay securely online by card, bank transfer or USSD in the student portal, or at the academy office.',
        ],
        action: { label: 'Pay now', url: `${config.webUrl}/portal/payments` },
      }),
    })
    sent++
  }
  return sent
}

async function leadFollowUps() {
  // Nudge enquiries 3 and 10 days after they came in, unless they've applied or opted out.
  const leads = await many(
    `SELECT id, name, email, programme_interest FROM leads
      WHERE consent AND email IS NOT NULL AND status IN ('new', 'contacted', 'interested')
        AND created_at::date = ANY($1::date[])
        AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(leads.email) AND u.role IN ('applicant', 'student'))`,
    [[shift(-3), shift(-10)]],
  )
  for (const l of leads) {
    await sendMail({
      to: l.email,
      subject: 'Ready to start your culinary journey?',
      html: layout({
        heading: `Hello ${l.name.split(' ')[0]}, still thinking about it?`,
        paragraphs: [
          `Thanks again for your interest${l.programme_interest ? ` in ${l.programme_interest}` : ''}. Applying online takes about 10 minutes, and you can save your progress and come back any time.`,
          'Questions? Reply to this email or call 08117248206 — we’re happy to help.',
        ],
        action: { label: 'Apply online', url: `${config.webUrl}/admissions/apply` },
      }),
    })
  }
  return leads.length
}

async function housekeeping() {
  const s = await query(`DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'`)
  const t = await query(`DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'`)
  // Files from abandoned drafts (no submission in 90 days) are removed to respect data minimisation (NDPA).
  const f = await query(
    `DELETE FROM files WHERE id IN (
       SELECT d.file_id FROM application_documents d JOIN applications a ON a.id = d.application_id
        WHERE a.status = 'draft' AND a.updated_at < now() - interval '90 days')`,
  )
  return { sessions: s.rowCount, tokens: t.rowCount, files: f.rowCount }
}

try {
  const fees = await feeReminders()
  const leads = await leadFollowUps()
  const cleaned = await housekeeping()
  console.log(JSON.stringify({ job: 'daily', date: iso(today), feeReminders: fees, leadFollowUps: leads, cleaned }))
} catch (err) {
  console.error('daily job failed', err)
  process.exitCode = 1
} finally {
  await pool.end()
}
