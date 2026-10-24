// Authentication: signup, login (email or student ID), lockout, OTP, password reset (spec §8.1, §12).
import { Router } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { one, query, tx } from '../db/pool.js'
import { config } from '../config.js'
import { parse, email, phone, password, requiredText } from '../lib/validate.js'
import { randomToken, hashToken, otpCode, hashPassword, checkPassword } from '../lib/security.js'
import { sendMail, layout } from '../lib/mailer.js'
import { getSettings } from '../lib/settings.js'
import { audit } from '../lib/audit.js'
import { requireAuth, ADMIN_ROLES } from '../middleware/auth.js'
import { HttpError, badRequest } from '../middleware/errors.js'

export const auth = Router()

const MAX_FAILED = 5
const LOCK_MINUTES = 15
// Compared against when the user doesn't exist, so response timing doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync(randomToken(), 12)

const limiter = (max, minutes) =>
  rateLimit({ windowMs: minutes * 60_000, limit: max, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes and try again.' } })

const isAdminRole = (role) => ADMIN_ROLES.includes(role)

export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    fullName: u.full_name,
    phone: u.phone,
    twoFactorEnabled: u.two_factor_enabled,
    mustChangePassword: u.must_change_password,
  }
}

async function createSession(req, user) {
  const token = randomToken()
  const days = isAdminRole(user.role) ? config.sessionDays.staff : config.sessionDays.student
  await query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
    [user.id, hashToken(token), req.get('user-agent')?.slice(0, 300) ?? null, req.ip, days],
  )
  await query('UPDATE users SET last_login_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id])
  return token
}

// ── Signup (applicants) ──────────────────────────────────────────────────────

const signupSchema = z.object({
  fullName: requiredText(120),
  email,
  phone,
  password,
  consent: z.literal(true, { message: 'Please accept the privacy policy to continue' }),
  website: z.string().max(0).optional(), // honeypot: real users leave this empty
})

auth.post('/signup', limiter(10, 60), async (req, res) => {
  const body = parse(signupSchema, req.body)
  const exists = await one('SELECT id FROM users WHERE lower(email) = $1', [body.email])
  if (exists) throw new HttpError(409, 'An account with this email already exists. Try signing in or resetting your password.')

  const user = await one(
    `INSERT INTO users (email, password_hash, role, full_name, phone, password_changed_at)
     VALUES ($1, $2, 'applicant', $3, $4, now()) RETURNING *`,
    [body.email, await hashPassword(body.password), body.fullName, body.phone],
  )
  const token = await createSession(req, user)
  sendMail({
    to: user.email,
    subject: 'Welcome to The Chefs Culinary Academy',
    html: layout({
      heading: `Welcome, ${body.fullName.split(' ')[0]}!`,
      paragraphs: [
        'Your applicant account has been created. You can now complete your online application, save your progress and track its status.',
      ],
      action: { label: 'Continue your application', url: `${config.webUrl}/admissions/apply` },
    }),
  })
  res.status(201).json({ token, user: publicUser(user) })
})

// ── Login ────────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or student ID').max(254),
  password: z.string().min(1, 'Enter your password').max(128),
  portal: z.enum(['student', 'admin']).default('student'),
})

auth.post('/login', limiter(20, 15), async (req, res) => {
  const { identifier, password: pw, portal } = parse(loginSchema, req.body)
  const user = identifier.includes('@')
    ? await one('SELECT * FROM users WHERE lower(email) = lower($1)', [identifier])
    : await one(
        `SELECT u.* FROM users u JOIN students s ON s.user_id = u.id WHERE upper(s.student_number) = upper($1)`,
        [identifier],
      )

  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.locked_until) - Date.now()) / 60_000)
    throw new HttpError(423, `Too many failed attempts. Your account is locked for ${mins} more minute${mins === 1 ? '' : 's'}.`)
  }

  const ok = await checkPassword(pw, user?.password_hash ?? DUMMY_HASH)
  if (!user || !ok) {
    if (user) {
      // Lock after MAX_FAILED consecutive failures; the counter restarts once locked.
      await query(
        `UPDATE users
            SET failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
                locked_until  = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
          WHERE id = $1`,
        [user.id, MAX_FAILED, LOCK_MINUTES],
      )
    }
    throw new HttpError(401, 'Incorrect email/student ID or password')
  }
  if (!user.is_active) throw new HttpError(403, 'This account has been deactivated. Please contact the academy.')
  if (portal === 'admin' && !isAdminRole(user.role)) throw new HttpError(403, 'This account does not have staff access. Use the student portal instead.')
  if (portal === 'student' && isAdminRole(user.role)) throw new HttpError(403, 'Staff accounts sign in through the admin portal.')

  const { security } = await getSettings()
  const needsOtp = user.two_factor_enabled || (isAdminRole(user.role) && security.requireAdminTwoFactor)
  if (needsOtp) {
    const challenge = randomToken(24)
    const code = otpCode()
    await query(`UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'login_otp' AND used_at IS NULL`, [user.id])
    await query(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, code_hash, expires_at) VALUES ($1, 'login_otp', $2, $3, now() + interval '10 minutes')`,
      [user.id, hashToken(challenge), hashToken(code)],
    )
    await sendMail({
      to: user.email,
      subject: `Your sign-in code: ${code}`,
      html: layout({ heading: 'Your sign-in code', paragraphs: [`Use this code to finish signing in: ${code}`, 'It expires in 10 minutes. If you did not try to sign in, change your password.'] }),
    })
    return res.json({ otpRequired: true, challenge, sentTo: maskEmail(user.email) })
  }

  const token = await createSession(req, user)
  if (isAdminRole(user.role)) await audit({ ...req, user }, 'auth.login', 'user', user.id)
  res.json({ token, user: publicUser(user) })
})

function maskEmail(e) {
  const [name, domain] = e.split('@')
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`
}

auth.post('/otp', limiter(20, 15), async (req, res) => {
  const { challenge, code } = parse(z.object({ challenge: z.string().min(10).max(100), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body)
  const row = await one(
    `SELECT * FROM auth_tokens WHERE purpose = 'login_otp' AND token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hashToken(challenge)],
  )
  if (!row || row.attempts >= 5) throw new HttpError(401, 'This code has expired. Please sign in again.')
  if (row.code_hash !== hashToken(code)) {
    await query('UPDATE auth_tokens SET attempts = attempts + 1 WHERE id = $1', [row.id])
    throw new HttpError(401, 'Incorrect code')
  }
  await query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [row.id])
  const user = await one('SELECT * FROM users WHERE id = $1 AND is_active', [row.user_id])
  if (!user) throw new HttpError(401, 'Account unavailable')
  const token = await createSession(req, user)
  if (isAdminRole(user.role)) await audit({ ...req, user }, 'auth.login', 'user', user.id, { otp: true })
  res.json({ token, user: publicUser(user) })
})

auth.post('/logout', async (req, res) => {
  if (req.sessionId) await query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.sessionId])
  res.json({ ok: true })
})

// ── Current user ─────────────────────────────────────────────────────────────

auth.get('/me', requireAuth, async (req, res) => {
  const student = req.user.role === 'student'
    ? await one(
        `SELECT s.id, s.student_number, s.first_name, s.last_name, s.status, s.photo_file_id IS NOT NULL AS has_photo,
                p.name AS programme_name, c.name AS cohort_name
           FROM students s LEFT JOIN programmes p ON p.id = s.programme_id LEFT JOIN cohorts c ON c.id = s.cohort_id
          WHERE s.user_id = $1`,
        [req.user.id],
      )
    : null
  res.json({ user: publicUser(req.user), student })
})

const profileSchema = z.object({ fullName: requiredText(120).optional(), phone: phone.optional() })

auth.patch('/me', requireAuth, async (req, res) => {
  const body = parse(profileSchema, req.body)
  const user = await one(
    `UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone), updated_at = now() WHERE id = $1 RETURNING *`,
    [req.user.id, body.fullName ?? null, body.phone ?? null],
  )
  res.json({ user: publicUser(user) })
})

auth.post('/change-password', requireAuth, limiter(10, 15), async (req, res) => {
  const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string().min(1, 'Required'), newPassword: password }), req.body)
  const user = await one('SELECT * FROM users WHERE id = $1', [req.user.id])
  if (!(await checkPassword(currentPassword, user.password_hash))) throw badRequest('Current password is incorrect', { currentPassword: 'Incorrect password' })
  await tx(async (db) => {
    await db.query(
      'UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = false, updated_at = now() WHERE id = $1',
      [user.id, await hashPassword(newPassword)],
    )
    // Sign out every other device.
    await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [user.id, req.sessionId])
  })
  res.json({ ok: true })
})

auth.post('/two-factor', requireAuth, async (req, res) => {
  const { enabled, password: pw } = parse(z.object({ enabled: z.boolean(), password: z.string().min(1, 'Required') }), req.body)
  const user = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id])
  if (!(await checkPassword(pw, user.password_hash))) throw badRequest('Password is incorrect', { password: 'Incorrect password' })
  const updated = await one('UPDATE users SET two_factor_enabled = $2, updated_at = now() WHERE id = $1 RETURNING *', [req.user.id, enabled])
  res.json({ user: publicUser(updated) })
})

// ── Password reset ───────────────────────────────────────────────────────────

auth.post('/forgot-password', limiter(5, 15), async (req, res) => {
  const { identifier } = parse(z.object({ identifier: z.string().trim().min(1, 'Enter your email or student ID').max(254) }), req.body)
  const user = identifier.includes('@')
    ? await one('SELECT * FROM users WHERE lower(email) = lower($1) AND is_active', [identifier])
    : await one('SELECT u.* FROM users u JOIN students s ON s.user_id = u.id WHERE upper(s.student_number) = upper($1) AND u.is_active', [identifier])

  if (user) {
    const token = randomToken()
    await query(`UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL`, [user.id])
    await query(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, 'password_reset', $2, now() + interval '1 hour')`,
      [user.id, hashToken(token)],
    )
    const url = isAdminRole(user.role) ? `${config.adminUrl}/reset-password?token=${token}` : `${config.webUrl}/portal/reset-password?token=${token}`
    await sendMail({
      to: user.email,
      subject: 'Reset your password',
      html: layout({
        heading: 'Reset your password',
        paragraphs: ['We received a request to reset your password. This link is valid for one hour.', 'If you did not ask for this, you can ignore this email — your password will not change.'],
        action: { label: 'Choose a new password', url },
      }),
    })
  }
  // Same response either way so the endpoint can't be used to discover accounts.
  res.json({ ok: true, message: 'If an account matches, we have emailed a password reset link.' })
})

auth.post('/reset-password', limiter(10, 15), async (req, res) => {
  const { token, password: pw } = parse(z.object({ token: z.string().min(20).max(200), password }), req.body)
  const row = await one(
    `SELECT * FROM auth_tokens WHERE purpose = 'password_reset' AND token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hashToken(token)],
  )
  if (!row) throw badRequest('This reset link is invalid or has expired. Please request a new one.')
  await tx(async (db) => {
    await db.query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [row.id])
    await db.query(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = false,
              failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
      [row.user_id, await hashPassword(pw)],
    )
    await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [row.user_id])
  })
  res.json({ ok: true })
})
