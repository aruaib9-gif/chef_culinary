// Student-record helpers shared by admissions conversion, admin create and bulk import.
import { Programme, Cohort, Invoice, User, AuthToken } from '../db/models.js'
import { randomToken, hashToken, hashPassword } from './security.js'
import { sendMail, layout } from './mailer.js'
import { nextStudentNumber } from './sequence.js'
import { config } from '../config.js'
import { badRequest } from '../http.js'

export { nextStudentNumber }

const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Raises the tuition charges for a newly enrolled student from the programme's fee and instalment plan.
 * Cohort fee overrides programme fee. Sponsored cohorts get a matching sponsor credit.
 */
export async function raiseTuitionCharges(session, { studentId, programmeId, cohortId, userId }) {
  const programme = await Programme.findById(programmeId, 'name fee_kobo instalment_plan').session(session ?? null).lean()
  const cohort = cohortId ? await Cohort.findById(cohortId, 'name fee_kobo sponsor starts_on').session(session ?? null).lean() : null
  const fee = cohort?.fee_kobo ?? programme?.fee_kobo
  if (!programme || !fee) return []
  const start = cohort?.starts_on ?? new Date().toISOString().slice(0, 10)
  const plan = programme.instalment_plan?.length ? programme.instalment_plan : [{ label: 'Tuition', percent: 100, dueWeeks: 0 }]

  const docs = []
  let allocated = 0
  for (const [i, part] of plan.entries()) {
    const amount = i === plan.length - 1 ? fee - allocated : Math.round((fee * Number(part.percent)) / 100)
    allocated += amount
    if (amount <= 0) continue
    docs.push({
      student_id: studentId, cohort_id: cohortId ?? null, category: 'tuition', kind: 'charge', amount_kobo: amount, created_by: userId ?? null,
      description: plan.length > 1 ? `${programme.name} — ${part.label}` : `${programme.name} tuition`,
      due_date: addDays(start, (Number(part.dueWeeks) || 0) * 7),
    })
  }
  if (cohort?.sponsor) {
    docs.push({
      student_id: studentId, cohort_id: cohortId, category: 'tuition', kind: 'sponsor', amount_kobo: fee, created_by: userId ?? null,
      description: `Tuition paid by sponsor (${cohort.sponsor})`,
    })
  }
  return docs.length ? Invoice.insertMany(docs, { session }) : []
}

/**
 * Creates (or reuses) the login for a student added by staff. Returns { user, setupToken }.
 * The user sets their own password via the emailed link (valid 7 days); no password is ever emailed.
 */
export async function ensureStudentAccount(session, { email, fullName, phone }) {
  let user = await User.findOne({ email: email.toLowerCase() }).session(session ?? null)
  if (user && ['super_admin', 'staff'].includes(user.role)) throw badRequest(`${email} belongs to a staff account`)
  if (!user) {
    ;[user] = await User.create(
      [{ email: email.toLowerCase(), password_hash: await hashPassword(randomToken()), role: 'student', full_name: fullName, phone: phone ?? null }],
      { session },
    )
  } else if (user.role === 'applicant') {
    user.role = 'student'
    await user.save({ session })
  }
  const setupToken = randomToken()
  await AuthToken.create(
    [{ user_id: user._id, purpose: 'password_reset', token_hash: hashToken(setupToken), expires_at: new Date(Date.now() + 7 * 86400_000) }],
    { session },
  )
  return { user, setupToken }
}

export async function sendAccountSetupEmail({ email, firstName, studentNumber, setupToken, sentBy }) {
  return sendMail({
    to: email,
    sentBy,
    subject: 'Your student portal account',
    html: layout({
      heading: `Welcome, ${firstName}`,
      paragraphs: [
        `A student portal account has been created for you. Your student ID is ${studentNumber}.`,
        'Use the button below to choose your password (the link is valid for 7 days). After that, sign in with your student ID or email address.',
      ],
      action: { label: 'Set your password', url: `${config.webUrl}/portal/reset-password?token=${setupToken}&welcome=1` },
    }),
  })
}
