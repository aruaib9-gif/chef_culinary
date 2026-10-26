// Authentication: signup, login (email or student ID), lockout, OTP, password reset (spec §8.1, §12).
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { User, Student, Session, AuthToken, Programme, Cohort } from '../db/models.js'
import { withTransaction } from '../db/mongo.js'
import { config } from '../config.js'
import { parse, email, phone, password, requiredText } from '../lib/validate.js'
import { randomToken, hashToken, otpCode, hashPassword, checkPassword } from '../lib/security.js'
import { sendMail, layout } from '../lib/mailer.js'
import { getSettings } from '../lib/settings.js'
import { audit } from '../lib/audit.js'
import { requireAuth, ADMIN_ROLES } from '../middleware/auth.js'
import { Router, HttpError, badRequest, rateLimit, defer } from '../http.js'

export const auth = new Router()

const MAX_FAILED = 5
const LOCK_MINUTES = 15
// Compared against when the user doesn't exist, so response timing doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync(randomToken(), 12)

const limiter = (max, minutes) => rateLimit({ windowMs: minutes * 60_000, limit: max })
const isAdminRole = (role) => ADMIN_ROLES.includes(role)
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function publicUser(u) {
  return {
    id: String(u.id ?? u._id),
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
  await Session.create({
    user_id: user._id, token_hash: hashToken(token), user_agent: req.get('user-agent')?.slice(0, 300) ?? null, ip: req.ip,
    expires_at: new Date(Date.now() + days * 86400_000),
  })
  await User.updateOne({ _id: user._id }, { $set: { last_login_at: new Date(), failed_logins: 0, locked_until: null } })
  return token
}

/** Finds a user by email or (case-insensitive) student ID. */
async function findByIdentifier(identifier, extra = {}) {
  if (identifier.includes('@')) return User.findOne({ email: identifier.toLowerCase(), ...extra }).lean()
  const s = await Student.findOne({ student_number: new RegExp(`^${escapeRegex(identifier)}$`, 'i'), user_id: { $ne: null } }, 'user_id').lean()
  return s ? User.findOne({ _id: s.user_id, ...extra }).lean() : null
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
  if (await User.exists({ email: body.email })) {
    throw new HttpError(409, 'An account with this email already exists. Try signing in or resetting your password.')
  }
  const user = await User.create({
    email: body.email, password_hash: await hashPassword(body.password), role: 'applicant', full_name: body.fullName, phone: body.phone,
    password_changed_at: new Date(),
  })
  const token = await createSession(req, user)
  defer(() => sendMail({
    to: user.email,
    subject: 'Welcome to The Chefs Culinary Academy',
    html: layout({
      heading: `Welcome, ${body.fullName.split(' ')[0]}!`,
      paragraphs: ['Your applicant account has been created. You can now complete your online application, save your progress and track its status.'],
      action: { label: 'Continue your application', url: `${config.webUrl}/admissions/apply` },
    }),
  }))
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
  const user = await findByIdentifier(identifier)

  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.locked_until) - Date.now()) / 60_000)
    throw new HttpError(423, `Too many failed attempts. Your account is locked for ${mins} more minute${mins === 1 ? '' : 's'}.`)
  }

  const ok = await checkPassword(pw, user?.password_hash ?? DUMMY_HASH)
  if (!user || !ok) {
    if (user) {
      // Lock after MAX_FAILED consecutive failures; the counter restarts once locked.
      const updated = await User.findOneAndUpdate({ _id: user._id }, { $inc: { failed_logins: 1 } }, { returnDocument: 'after' }).lean()
      if (updated.failed_logins >= MAX_FAILED) {
        await User.updateOne({ _id: user._id }, { $set: { failed_logins: 0, locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000) } })
      }
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
    await AuthToken.updateMany({ user_id: user._id, purpose: 'login_otp', used_at: null }, { $set: { used_at: new Date() } })
    await AuthToken.create({
      user_id: user._id, purpose: 'login_otp', token_hash: hashToken(challenge), code_hash: hashToken(code),
      expires_at: new Date(Date.now() + 10 * 60_000),
    })
    await sendMail({
      to: user.email,
      subject: `Your sign-in code: ${code}`,
      html: layout({ heading: 'Your sign-in code', paragraphs: [`Use this code to finish signing in: ${code}`, 'It expires in 10 minutes. If you did not try to sign in, change your password.'] }),
    })
    return res.json({ otpRequired: true, challenge, sentTo: maskEmail(user.email) })
  }

  const token = await createSession(req, user)
  if (isAdminRole(user.role)) await audit({ ...req, user: { id: user._id } }, 'auth.login', 'user', user._id)
  res.json({ token, user: publicUser(user) })
})

function maskEmail(e) {
  const [name, domain] = e.split('@')
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`
}

auth.post('/otp', limiter(20, 15), async (req, res) => {
  const { challenge, code } = parse(z.object({ challenge: z.string().min(10).max(100), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body)
  const row = await AuthToken.findOne({ purpose: 'login_otp', token_hash: hashToken(challenge), used_at: null, expires_at: { $gt: new Date() } }).lean()
  if (!row || row.attempts >= 5) throw new HttpError(401, 'This code has expired. Please sign in again.')
  if (row.code_hash !== hashToken(code)) {
    await AuthToken.updateOne({ _id: row._id }, { $inc: { attempts: 1 } })
    throw new HttpError(401, 'Incorrect code')
  }
  await AuthToken.updateOne({ _id: row._id }, { $set: { used_at: new Date() } })
  const user = await User.findOne({ _id: row.user_id, is_active: true }).lean()
  if (!user) throw new HttpError(401, 'Account unavailable')
  const token = await createSession(req, user)
  if (isAdminRole(user.role)) await audit({ ...req, user: { id: user._id } }, 'auth.login', 'user', user._id, { otp: true })
  res.json({ token, user: publicUser(user) })
})

auth.post('/logout', async (req, res) => {
  if (req.sessionId) await Session.updateOne({ _id: req.sessionId }, { $set: { revoked_at: new Date() } })
  res.json({ ok: true })
})

// ── Current user ─────────────────────────────────────────────────────────────

auth.get('/me', requireAuth, async (req, res) => {
  let student = null
  if (req.user.role === 'student') {
    const s = await Student.findOne({ user_id: req.user._id }).lean()
    if (s) {
      const [p, c] = await Promise.all([
        s.programme_id ? Programme.findById(s.programme_id, 'name').lean() : null,
        s.cohort_id ? Cohort.findById(s.cohort_id, 'name').lean() : null,
      ])
      student = {
        id: String(s._id), student_number: s.student_number, first_name: s.first_name, last_name: s.last_name, status: s.status,
        has_photo: Boolean(s.photo_file_id), programme_name: p?.name ?? null, cohort_name: c?.name ?? null,
      }
    }
  }
  res.json({ user: publicUser(req.user), student })
})

const profileSchema = z.object({ fullName: requiredText(120).optional(), phone: phone.optional() })

auth.patch('/me', requireAuth, async (req, res) => {
  const body = parse(profileSchema, req.body)
  const set = {}
  if (body.fullName) set.full_name = body.fullName
  if (body.phone) set.phone = body.phone
  const user = await User.findByIdAndUpdate(req.user._id, { $set: set }, { returnDocument: 'after' }).lean()
  res.json({ user: publicUser(user) })
})

auth.post('/change-password', requireAuth, limiter(10, 15), async (req, res) => {
  const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string().min(1, 'Required'), newPassword: password }), req.body)
  const user = await User.findById(req.user._id).lean()
  if (!(await checkPassword(currentPassword, user.password_hash))) throw badRequest('Current password is incorrect', { currentPassword: 'Incorrect password' })
  const hash = await hashPassword(newPassword)
  await withTransaction(async (session) => {
    await User.updateOne({ _id: user._id }, { $set: { password_hash: hash, password_changed_at: new Date(), must_change_password: false } }, { session })
    // Sign out every other device.
    await Session.updateMany({ user_id: user._id, _id: { $ne: req.sessionId }, revoked_at: null }, { $set: { revoked_at: new Date() } }, { session })
  })
  res.json({ ok: true })
})

auth.post('/two-factor', requireAuth, async (req, res) => {
  const { enabled, password: pw } = parse(z.object({ enabled: z.boolean(), password: z.string().min(1, 'Required') }), req.body)
  const user = await User.findById(req.user._id, 'password_hash').lean()
  if (!(await checkPassword(pw, user.password_hash))) throw badRequest('Password is incorrect', { password: 'Incorrect password' })
  const updated = await User.findByIdAndUpdate(req.user._id, { $set: { two_factor_enabled: enabled } }, { returnDocument: 'after' }).lean()
  res.json({ user: publicUser(updated) })
})

// ── Password reset ───────────────────────────────────────────────────────────

auth.post('/forgot-password', limiter(5, 15), async (req, res) => {
  const { identifier } = parse(z.object({ identifier: z.string().trim().min(1, 'Enter your email or student ID').max(254) }), req.body)
  const user = await findByIdentifier(identifier, { is_active: true })
  if (user) {
    const token = randomToken()
    await AuthToken.updateMany({ user_id: user._id, purpose: 'password_reset', used_at: null }, { $set: { used_at: new Date() } })
    await AuthToken.create({ user_id: user._id, purpose: 'password_reset', token_hash: hashToken(token), expires_at: new Date(Date.now() + 3600_000) })
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
  const row = await AuthToken.findOne({ purpose: 'password_reset', token_hash: hashToken(token), used_at: null, expires_at: { $gt: new Date() } }).lean()
  if (!row) throw badRequest('This reset link is invalid or has expired. Please request a new one.')
  const hash = await hashPassword(pw)
  await withTransaction(async (session) => {
    await AuthToken.updateOne({ _id: row._id }, { $set: { used_at: new Date() } }, { session })
    await User.updateOne(
      { _id: row.user_id },
      { $set: { password_hash: hash, password_changed_at: new Date(), must_change_password: false, failed_logins: 0, locked_until: null } },
      { session },
    )
    await Session.updateMany({ user_id: row.user_id, revoked_at: null }, { $set: { revoked_at: new Date() } }, { session })
  })
  res.json({ ok: true })
})
