import { one, query } from '../db/pool.js'
import { hashToken } from '../lib/security.js'
import { HttpError, forbidden } from './errors.js'

export const ADMIN_ROLES = ['super_admin', 'staff']

// Resolves `Authorization: Bearer <token>` to req.user. Does not reject anonymous requests.
export async function authenticate(req, res, next) {
  const header = req.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) return next()

  const row = await one(
    `SELECT s.id AS session_id, s.last_seen_at, u.id, u.email, u.role, u.full_name, u.phone, u.is_active,
            u.two_factor_enabled, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashToken(token)],
  )
  if (!row || !row.is_active) return next()

  const { session_id, last_seen_at, ...user } = row
  req.user = user
  req.sessionId = session_id
  if (Date.now() - new Date(last_seen_at).getTime() > 5 * 60_000) {
    query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [session_id]).catch(() => {})
  }
  next()
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue'))
  next()
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue'))
  if (!roles.includes(req.user.role)) return next(forbidden())
  next()
}

export const requireAdmin = requireRole(...ADMIN_ROLES)
export const requireSuperAdmin = requireRole('super_admin')

// For /api/student/*: loads the student record linked to the signed-in user.
export async function requireStudent(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue'))
  if (req.user.role !== 'student') return next(forbidden('This area is for enrolled students'))
  const student = await one(
    `SELECT s.*, p.name AS programme_name, p.slug AS programme_slug, c.name AS cohort_name,
            c.starts_on AS cohort_starts_on, c.ends_on AS cohort_ends_on, c.schedule AS cohort_schedule, c.sponsor AS cohort_sponsor
       FROM students s
       LEFT JOIN programmes p ON p.id = s.programme_id
       LEFT JOIN cohorts c ON c.id = s.cohort_id
      WHERE s.user_id = $1`,
    [req.user.id],
  )
  if (!student) return next(forbidden('No student record is linked to this account'))
  req.student = student
  next()
}
