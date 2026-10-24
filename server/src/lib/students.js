// Student-record helpers shared by admissions conversion, admin create and bulk import.
import { randomToken, hashToken, hashPassword } from './security.js'
import { sendMail, layout } from './mailer.js'
import { config } from '../config.js'
import { badRequest } from '../middleware/errors.js'

export async function nextStudentNumber(db) {
  const { n } = await db.one(`SELECT nextval('student_number_seq') AS n`)
  return `CCA/${new Date().getFullYear()}/${String(n).padStart(4, '0')}`
}

const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Raises the tuition charges for a newly enrolled student from the programme's fee and instalment plan.
 * Cohort fee overrides programme fee. Sponsored cohorts get a matching sponsor credit.
 */
export async function raiseTuitionCharges(db, { studentId, programmeId, cohortId, userId }) {
  const programme = await db.one('SELECT name, fee_kobo, instalment_plan FROM programmes WHERE id = $1', [programmeId])
  const cohort = cohortId ? await db.one('SELECT name, fee_kobo, sponsor, starts_on FROM cohorts WHERE id = $1', [cohortId]) : null
  const fee = cohort?.fee_kobo ?? programme?.fee_kobo
  if (!programme || !fee) return []
  const start = cohort?.starts_on ?? new Date().toISOString().slice(0, 10)
  const plan = Array.isArray(programme.instalment_plan) && programme.instalment_plan.length
    ? programme.instalment_plan
    : [{ label: 'Tuition', percent: 100, dueWeeks: 0 }]

  const created = []
  let allocated = 0
  for (const [i, part] of plan.entries()) {
    const amount = i === plan.length - 1 ? fee - allocated : Math.round((fee * Number(part.percent)) / 100)
    allocated += amount
    if (amount <= 0) continue
    created.push(await db.one(
      `INSERT INTO invoices (student_id, cohort_id, description, category, kind, amount_kobo, due_date, created_by)
       VALUES ($1, $2, $3, 'tuition', 'charge', $4, $5, $6) RETURNING *`,
      [studentId, cohortId, plan.length > 1 ? `${programme.name} — ${part.label}` : `${programme.name} tuition`, amount, addDays(start, (Number(part.dueWeeks) || 0) * 7), userId],
    ))
  }
  if (cohort?.sponsor) {
    created.push(await db.one(
      `INSERT INTO invoices (student_id, cohort_id, description, category, kind, amount_kobo, created_by)
       VALUES ($1, $2, $3, 'tuition', 'sponsor', $4, $5) RETURNING *`,
      [studentId, cohortId, `Tuition paid by sponsor (${cohort.sponsor})`, fee, userId],
    ))
  }
  return created
}

/**
 * Creates (or reuses) the login for a student added by staff. Returns { user, setupToken }.
 * The user sets their own password via the emailed link (valid 7 days); no password is ever emailed.
 */
export async function ensureStudentAccount(db, { email, fullName, phone }) {
  let user = await db.one('SELECT * FROM users WHERE lower(email) = lower($1)', [email])
  if (user && ['super_admin', 'staff'].includes(user.role)) {
    throw badRequest(`${email} belongs to a staff account`)
  }
  if (!user) {
    user = await db.one(
      `INSERT INTO users (email, password_hash, role, full_name, phone) VALUES ($1, $2, 'student', $3, $4) RETURNING *`,
      [email.toLowerCase(), await hashPassword(randomToken()), fullName, phone ?? null],
    )
  } else if (user.role === 'applicant') {
    user = await db.one(`UPDATE users SET role = 'student', updated_at = now() WHERE id = $1 RETURNING *`, [user.id])
  }
  const setupToken = randomToken()
  await db.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, 'password_reset', $2, now() + interval '7 days')`,
    [user.id, hashToken(setupToken)],
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
