// Staff accounts, settings, lookups, audit trail and message log (spec §9.1, §9.5, §9.6, §12).
import { Router } from 'express'
import { z } from 'zod'
import { many, one, query, tx } from '../../db/pool.js'
import { config } from '../../config.js'
import { parse, idParam, email, requiredText, optionalText, pagination, paged } from '../../lib/validate.js'
import { randomToken, hashToken, hashPassword } from '../../lib/security.js'
import { getSettings, saveSetting, settingDefaults } from '../../lib/settings.js'
import { sendMail, layout, emailConfigured } from '../../lib/mailer.js'
import { paystackEnabled } from '../../lib/paystack.js'
import { sendCsv } from '../../lib/csv.js'
import { audit } from '../../lib/audit.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { badRequest, notFoundError } from '../../middleware/errors.js'

export const system = Router()

// Dropdown data used across the admin UI.
system.get('/lookups', async (req, res) => {
  const [programmes, cohorts, courses] = await Promise.all([
    many('SELECT id, slug, name, type, is_published FROM programmes ORDER BY sort_order, name'),
    many(`SELECT c.id, c.name, c.programme_id, c.status, c.sponsor, p.name AS programme_name FROM cohorts c JOIN programmes p ON p.id = c.programme_id
           ORDER BY (c.status = 'active') DESC, c.starts_on DESC NULLS LAST, c.name`),
    many('SELECT c.id, c.name, c.slug, c.type, c.grading_scheme_id, COALESCE(array_agg(pc.programme_id::int) FILTER (WHERE pc.programme_id IS NOT NULL), \'{}\') AS programme_ids FROM courses c LEFT JOIN programme_courses pc ON pc.course_id = c.id GROUP BY c.id ORDER BY c.name'),
  ])
  res.json({ programmes, cohorts, courses, integrations: { email: emailConfigured(), paystack: paystackEnabled() }, role: req.user.role })
})

// ── Staff users (super admin) ────────────────────────────────────────────────

system.get('/users', requireSuperAdmin, async (req, res) => {
  res.json(await many(
    `SELECT id, email, full_name, phone, role, is_active, two_factor_enabled, last_login_at, locked_until, created_at
       FROM users WHERE role IN ('super_admin', 'staff') ORDER BY role, full_name`,
  ))
})

system.post('/users', requireSuperAdmin, async (req, res) => {
  const b = parse(z.object({ fullName: requiredText(120), email, phone: optionalText(30), role: z.enum(['super_admin', 'staff']) }), req.body)
  if (await one('SELECT 1 FROM users WHERE lower(email) = $1', [b.email])) throw badRequest('An account with this email already exists', { email: 'Already in use' })
  const token = randomToken()
  const user = await tx(async (t) => {
    const u = await t.one(
      `INSERT INTO users (email, password_hash, role, full_name, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, full_name, role`,
      [b.email, await hashPassword(randomToken()), b.role, b.fullName, b.phone],
    )
    await t.query(`INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, 'password_reset', $2, now() + interval '7 days')`, [u.id, hashToken(token)])
    await audit(req, 'user.create', 'user', u.id, { email: b.email, role: b.role }, t)
    return u
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
  const target = await one(`SELECT * FROM users WHERE id = $1 AND role IN ('super_admin', 'staff')`, [uid])
  if (!target) throw notFoundError('Staff user not found')
  if (uid === req.user.id && (b.role === 'staff' || b.isActive === false)) throw badRequest('You cannot demote or deactivate your own account')
  if (target.role === 'super_admin' && (b.role === 'staff' || b.isActive === false)) {
    const { n } = await one(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'super_admin' AND is_active`)
    if (n <= 1) throw badRequest('There must be at least one active super admin')
  }
  const row = await one(
    `UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone), role = COALESCE($4, role),
            is_active = COALESCE($5, is_active), updated_at = now()
      WHERE id = $1 RETURNING id, email, full_name, phone, role, is_active`,
    [uid, b.fullName ?? null, b.phone, b.role ?? null, b.isActive ?? null],
  )
  if (b.isActive === false || b.role) await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [uid])
  await audit(req, 'user.update', 'user', uid, b)
  res.json(row)
})

system.post('/users/:id/unlock', requireSuperAdmin, async (req, res) => {
  await query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [idParam(req)])
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

const auditFilters = pagination.extend({ action: z.string().max(60).optional(), userId: z.coerce.number().int().optional() })

function auditWhere(f) {
  const params = []
  const c = []
  if (f.action) c.push(`a.action ILIKE $${params.push(`${f.action}%`)}`)
  if (f.userId) c.push(`a.user_id = $${params.push(f.userId)}`)
  if (f.q) c.push(`(a.entity_id ILIKE $${params.push(`%${f.q}%`)} OR a.details::text ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`)
  return { where: c.length ? `WHERE ${c.join(' AND ')}` : '', params }
}

system.get('/audit-log', requireSuperAdmin, async (req, res) => {
  const f = parse(auditFilters, req.query)
  const { where, params } = auditWhere(f)
  const rows = await many(
    `SELECT a.*, u.full_name AS user_name, u.email AS user_email, COUNT(*) OVER() AS total_count
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${where}
      ORDER BY a.created_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
    params,
  )
  res.json(paged(rows, f))
})

system.get('/audit-log.csv', requireSuperAdmin, async (req, res) => {
  const f = parse(auditFilters, req.query)
  const { where, params } = auditWhere(f)
  const rows = await many(`SELECT a.*, u.full_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${where} ORDER BY a.created_at DESC LIMIT 50000`, params)
  sendCsv(res, 'audit-log.csv', rows, [
    { key: 'created_at', label: 'When' }, { key: 'user_name', label: 'User' }, { key: 'action', label: 'Action' },
    { key: 'entity', label: 'Entity' }, { key: 'entity_id', label: 'Entity ID' }, { key: 'details', label: 'Details' }, { key: 'ip', label: 'IP' },
  ])
})

system.get('/message-log', requireSuperAdmin, async (req, res) => {
  const f = parse(pagination, req.query)
  const rows = await many(
    `SELECT m.*, u.full_name AS sent_by_name, COUNT(*) OVER() AS total_count FROM message_log m LEFT JOIN users u ON u.id = m.sent_by
      ${f.q ? 'WHERE m.recipient ILIKE $1 OR m.subject ILIKE $1' : ''}
      ORDER BY m.created_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
    f.q ? [`%${f.q}%`] : [],
  )
  res.json(paged(rows, f))
})
