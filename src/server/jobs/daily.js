// Daily automation (Vercel Cron → GET /api/cron/daily): fee reminders before/after due dates,
// lead follow-ups and housekeeping. Spec §6.2 "Follow-up automation" and §10 "Payment reminders".
import { Invoice, Student, User, Lead, Application, File } from '../db/models.js'
import { config } from '../config.js'
import { instalmentSchedule } from '../lib/finance.js'
import { formatKobo } from '../lib/money.js'
import { sendMail, layout } from '../lib/mailer.js'
import { deleteFile } from '../lib/storage.js'
import { byIds, pick } from '../lib/lookup.js'

const lagosToday = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shift = (days) => {
  const d = lagosToday()
  d.setDate(d.getDate() + days)
  return iso(d)
}

async function feeReminders() {
  // Remind 3 days before a due date, and 1, 7 and 14 days after it if still unpaid.
  const targets = { [shift(3)]: 'upcoming', [shift(-1)]: 'overdue', [shift(-7)]: 'overdue', [shift(-14)]: 'overdue' }
  const studentIds = await Invoice.distinct('student_id', { kind: 'charge', voided_at: null, due_date: { $in: Object.keys(targets) } })
  const students = await Student.find({ _id: { $in: studentIds }, status: 'active' }, 'first_name email user_id').lean()
  const users = await byIds(User, students.map((s) => s.user_id), 'email')
  let sent = 0
  for (const s of students) {
    const to = pick(users, s.user_id, 'email') ?? s.email
    if (!to) continue
    const item = (await instalmentSchedule(s._id)).find((x) => x.outstanding_kobo > 0 && targets[x.due_date])
    if (!item) continue
    const overdue = targets[item.due_date] === 'overdue'
    await sendMail({
      to,
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
  const windows = [-3, -10].map((d) => {
    const start = new Date(`${shift(d)}T00:00:00+01:00`)
    return { created_at: { $gte: start, $lt: new Date(start.getTime() + 86_400_000) } }
  })
  const leads = await Lead.find({ consent: true, email: { $ne: null }, status: { $in: ['new', 'contacted', 'interested'] }, $or: windows }).lean()
  const registered = new Set((await User.find({ email: { $in: leads.map((l) => l.email) }, role: { $in: ['applicant', 'student'] } }, 'email').lean()).map((u) => u.email))
  let sent = 0
  for (const l of leads.filter((x) => !registered.has(x.email))) {
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
    sent++
  }
  return sent
}

async function housekeeping() {
  // Files from abandoned drafts (no update in 90 days) are removed to respect data minimisation (NDPA).
  const stale = await Application.find({ status: 'draft', updated_at: { $lt: new Date(Date.now() - 90 * 86_400_000) } }, 'documents').lean()
  let files = 0
  for (const a of stale) {
    for (const d of a.documents ?? []) {
      await deleteFile(d.file_id)
      files++
    }
    if (a.documents?.length) await Application.updateOne({ _id: a._id }, { $set: { documents: [] } })
  }
  // Uploads that were started but never completed.
  const abandoned = await File.find({ status: 'pending', created_at: { $lt: new Date(Date.now() - 86_400_000) } }, '_id').lean()
  for (const f of abandoned) await deleteFile(f._id)
  // Expired sessions and tokens are removed automatically by TTL indexes.
  return { files, abandonedUploads: abandoned.length }
}

export async function runDailyJobs() {
  const feeReminderCount = await feeReminders()
  const leadFollowUpCount = await leadFollowUps()
  const cleaned = await housekeeping()
  return { date: shift(0), feeReminders: feeReminderCount, leadFollowUps: leadFollowUpCount, cleaned }
}
