import { Session, User, Student, Programme, Cohort } from '../db/models.js'
import { hashToken } from '../lib/security.js'
import { HttpError, forbidden } from '../http.js'

export const ADMIN_ROLES = ['super_admin', 'staff']

// Resolves `Authorization: Bearer <token>` to req.user. Does not reject anonymous requests.
export async function authenticate(req) {
  const header = req.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) return
  const session = await Session.findOne({ token_hash: hashToken(token), revoked_at: null, expires_at: { $gt: new Date() } }).lean()
  if (!session) return
  const user = await User.findById(session.user_id).lean()
  if (!user || !user.is_active) return
  req.user = { ...user, id: String(user._id) }
  req.sessionId = session._id
  if (Date.now() - new Date(session.last_seen_at).getTime() > 5 * 60_000) {
    Session.updateOne({ _id: session._id }, { $set: { last_seen_at: new Date() } }).catch(() => {})
  }
}

export async function requireAuth(req) {
  if (!req.user) throw new HttpError(401, 'Please sign in to continue')
}

export const requireRole = (...roles) => async (req) => {
  if (!req.user) throw new HttpError(401, 'Please sign in to continue')
  if (!roles.includes(req.user.role)) throw forbidden()
}

export const requireAdmin = requireRole(...ADMIN_ROLES)
export const requireSuperAdmin = requireRole('super_admin')

// For /api/student/*: loads the student record linked to the signed-in user, with programme and cohort details.
export async function requireStudent(req) {
  if (!req.user) throw new HttpError(401, 'Please sign in to continue')
  if (req.user.role !== 'student') throw forbidden('This area is for enrolled students')
  const s = await Student.findOne({ user_id: req.user._id }).lean()
  if (!s) throw forbidden('No student record is linked to this account')
  const [p, c] = await Promise.all([
    s.programme_id ? Programme.findById(s.programme_id, 'name slug').lean() : null,
    s.cohort_id ? Cohort.findById(s.cohort_id, 'name starts_on ends_on schedule sponsor').lean() : null,
  ])
  req.student = {
    ...s,
    id: String(s._id),
    programme_name: p?.name ?? null,
    programme_slug: p?.slug ?? null,
    cohort_name: c?.name ?? null,
    cohort_starts_on: c?.starts_on ?? null,
    cohort_ends_on: c?.ends_on ?? null,
    cohort_schedule: c?.schedule ?? null,
    cohort_sponsor: c?.sponsor ?? null,
  }
}
