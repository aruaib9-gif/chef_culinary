// Staff accounts, settings, lookups, audit trail and message log (spec §9.1, §9.5, §9.6, §12).
import { z } from 'zod'
import { Programme, Cohort, Course, User, AuthToken, Session, AuditLog, MessageLog } from '../../db/models.js'
import { withTransaction } from '../../db/mongo.js'
import { config } from '../../config.js'
import { parse, idParam, email, requiredText, optionalText, pagination, paged } from '../../lib/validate.js'
import { randomToken, hashToken, hashPassword } from '../../lib/security.js'
import { getSettings, saveSetting, settingDefaults } from '../../lib/settings.js'
import { sendMail, layout, emailConfigured } from '../../lib/mailer.js'
import { paystackEnabled } from '../../lib/paystack.js'
import { sendCsv } from '../../lib/csv.js'
import { audit } from '../../lib/audit.js'
import { byIds, pick, contains, escapeRegex } from '../../lib/lookup.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { Router, badRequest, notFoundError } from '../../http.js'

export const system = new Router()

// Dropdown data used across the admin UI.
system.get('/lookups', async (req, res) => {
  const [programmes, cohorts, courses] = await Promise.all([
    Programme.find({}, 'slug name type is_published course_ids sort_order').sort({ sort_order: 1, name: 1 }).lean(),
    Cohort.find({}, 'name programme_id status sponsor starts_on').lean(),
    Course.find({}, 'name slug type grading_scheme_id').sort({ name: 1 }).lean(),
  ])
  const progName = new Map(programmes.map((p) => [String(p._id), p.name]))
  cohorts.sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || (b.starts_on ?? '').localeCompare(a.starts_on ?? '') || a.name.localeCompare(b.name))
  res.json({
    programmes: programmes.map(({ course_ids, sort_order, ...p }) => p),
    cohorts: cohorts.map((c) => ({ ...c, programme_name: progName.get(String(c.programme_id)) ?? null })),
    courses: courses.map((c) => ({ ...c, programme_ids: programmes.filter((p) => p.course_ids.some((x) => String(x) === String(c._id))).map((p) => String(p._id)) })),
    integrations: { email: emailConfigured(), paystack: paystackEnabled() },
    role: req.user.role,
  })
})

// ── Staff users (super admin) ────────────────────────────────────────────────

system.get('/users', requireSuperAdmin, async (req, res) => {
  res.json(await User.find({ role: { $in: ['super_admin', 'staff'] } }, 'email full_name phone role is_active two_factor_enabled last_login_at locked_until created_at')
    .sort({ role: 1, full_name: 1 }).lean())
})

system.post('/users', requireSuperAdmin, async (req, res) => {
  const b = parse(z.object({ fullName: requiredText(120), email, phone: optionalText(30), role: z.enum(['super_admin', 'staff']) }), req.body)
  if (await User.exists({ email: b.email })) throw badRequest('An account with this email already exists', { email: 'Already in use' })
  const token = randomToken()
  const hash = await hashPassword(randomToken())
  const user = await withTransaction(async (session) => {
    const [u] = await User.create([{ email: b.email, password_hash: hash, role: b.role, full_name: b.fullName, phone: b.phone }], { session })
    await AuthToken.create([{ user_id: u._id, purpose: 'password_reset', token_hash: hashToken(token), expires_at: new Date(Date.now() + 7 * 86400_000) }], { session })
    await audit(req, 'user.create', 'user', u._id, { email: b.email, role: b.role }, session)
    return { id: String(u._id), email: u.email, full_name: u.full_name, role: u.role }
  })
  const link = `${config.adminUrl}/reset-password?token=${token}&welcome=1`
  await sendMail({
    to: b.email,
    sentBy: req.user.id,
    subject: 'Your staff account — The Chefs Culinary Academy',
    html: layout({ heading: `Welcome, ${b.fullName.split(' ')[0]}`, paragraphs: ['A staff account has been created for you on the academy admin portal. Set your password using the link below (valid for 7 days).'], action: { label: 'Set your password', url: link } }),
  })
  // Without SMTP the link is returned so the super admin can hand it over directly.
  res.status(201).json({ ...user, setupLink: emailConfigured() ? undefined : link })
})

system.patch('/users/:id', requireSuperAdmin, async (req, res) => {
  const uid = idParam(req)
  const b = parse(z.object({ fullName: requiredText(120).optional(), phone: optionalText(30), role: z.enum(['super_admin', 'staff']).optional(), isActive: z.boolean().optional() }), req.body)
  const target = await User.findOne({ _id: uid, role: { $in: ['super_admin', 'staff'] } }).lean()
  if (!target) throw notFoundError('Staff user not found')
  if (uid === req.user.id && (b.role === 'staff' || b.isActive === false)) throw badRequest('You cannot demote or deactivate your own account')
  if (target.role === 'super_admin' && (b.role === 'staff' || b.isActive === false)) {
    const n = await User.countDocuments({ role: 'super_admin', is_active: true })
    if (n <= 1) throw badRequest('There must be at least one active super admin')
  }
  const set = {}
  if (b.fullName) set.full_name = b.fullName
  if (b.phone) set.phone = b.phone
  if (b.role) set.role = b.role
  if (b.isActive != null) set.is_active = b.isActive
  const row = await User.findByIdAndUpdate(uid, { $set: set }, { returnDocument: 'after', projection: 'email full_name phone role is_active' }).lean()
  if (b.isActive === false || b.role) await Session.updateMany({ user_id: uid, revoked_at: null }, { $set: { revoked_at: new Date() } })
  await audit(req, 'user.update', 'user', uid, b)
  res.json(row)
})

system.post('/users/:id/unlock', requireSuperAdmin, async (req, res) => {
  await User.updateOne({ _id: idParam(req) }, { $set: { failed_logins: 0, locked_until: null } })
  await audit(req, 'user.unlock', 'user', idParam(req))
  res.json({ ok: true })
})

// ── Settings ─────────────────────────────────────────────────────────────────

const url = z.string().trim().url('Enter a full URL').max(500).or(z.literal(''))
const settingSchemas = {
  site: z.object({
    name: requiredText(160), legalName: requiredText(200), address: requiredText(300), phone: requiredText(30),
    emails: z.array(z.string().trim().email()).min(1).max(5), whatsappNumber: z.string().regex(/^\d{8,15}$/, 'Digits only, with country code (e.g. 2348117248206)'),
    whatsappMessage: requiredText(300),
  }),
  social: z.object({ facebook: url, instagram: url, youtube: url, tiktok: url, x: url, linkedin: url }).partial(),
  results: z.object({ withholdIfOwing: z.boolean(), showPositions: z.boolean() }),
  attendance: z.object({ lowAttendanceThreshold: z.coerce.number().int().min(1).max(100) }),
  security: z.object({ requireAdminTwoFactor: z.boolean() }),
}

system.get('/settings', async (req, res) => res.json(await getSettings()))

system.put('/settings/:key', requireSuperAdmin, async (req, res) => {
  const schema = settingSchemas[req.params.key]
  if (!schema) throw notFoundError('Unknown setting')
  const value = parse(schema, { ...settingDefaults[req.params.key], ...req.body })
  await saveSetting(req.params.key, value, req.user.id)
  await audit(req, 'settings.update', 'setting', req.params.key, value)
  res.json((await getSettings())[req.params.key])
})

// ── Audit trail & message log ────────────────────────────────────────────────

const auditFilters = pagination.extend({ action: z.string().max(60).optional(), userId: z.string().regex(/^[a-f\d]{24}$/i).optional() })

async function auditQuery(f) {
  const q = {}
  if (f.action) q.action = new RegExp(`^${escapeRegex(f.action)}`, 'i')
  if (f.userId) q.user_id = f.userId
  if (f.q) {
    const re = contains(f.q)
    const users = (await User.find({ full_name: re }, '_id').lean()).map((u) => u._id)
    q.$or = [{ entity_id: re }, { action: re }, { user_id: { $in: users } }]
  }
  return q
}

async function withUsers(rows) {
  const users = await byIds(User, rows.map((r) => r.user_id), 'full_name email')
  return rows.map((r) => ({ ...r, user_name: pick(users, r.user_id, 'full_name'), user_email: pick(users, r.user_id, 'email') }))
}

system.get('/audit-log', requireSuperAdmin, async (req, res) => {
  const f = parse(auditFilters, req.query)
  const q = await auditQuery(f)
  const [rows, total] = await Promise.all([
    AuditLog.find(q).sort({ created_at: -1 }).skip((f.page - 1) * f.pageSize).limit(f.pageSize).lean(),
    AuditLog.countDocuments(q),
  ])
  res.json(paged(await withUsers(rows), total, f))
})

system.get('/audit-log.csv', requireSuperAdmin, async (req, res) => {
  const rows = await withUsers(await AuditLog.find(await auditQuery(parse(auditFilters, req.query))).sort({ created_at: -1 }).limit(50000).lean())
  sendCsv(res, 'audit-log.csv', rows, [
    { key: 'created_at', label: 'When' }, { key: 'user_name', label: 'User' }, { key: 'action', label: 'Action' },
    { key: 'entity', label: 'Entity' }, { key: 'entity_id', label: 'Entity ID' }, { key: 'details', label: 'Details' }, { key: 'ip', label: 'IP' },
  ])
})

system.get('/message-log', requireSuperAdmin, async (req, res) => {
  const f = parse(pagination, req.query)
  const q = f.q ? { $or: [{ recipient: contains(f.q) }, { subject: contains(f.q) }] } : {}
  const [rows, total] = await Promise.all([
    MessageLog.find(q).sort({ created_at: -1 }).skip((f.page - 1) * f.pageSize).limit(f.pageSize).lean(),
    MessageLog.countDocuments(q),
  ])
  const users = await byIds(User, rows.map((r) => r.sent_by), 'full_name')
  res.json(paged(rows.map((r) => ({ ...r, sent_by_name: pick(users, r.sent_by, 'full_name') })), total, f))
})
