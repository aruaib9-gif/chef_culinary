// Unauthenticated endpoints: public settings and certificate / result verification (spec §9.3, §11).
import { Certificate, DocumentVerification, Student, Programme } from '../db/models.js'
import { getSettings, publicSettingKeys } from '../lib/settings.js'
import { listGallery } from '../lib/gallery.js'
import { Router, rateLimit, badRequest, notFoundError } from '../http.js'

export const publicRoutes = new Router()

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

publicRoutes.get('/settings', async (req, res) => {
  const all = await getSettings()
  res.set('Cache-Control', 'public, max-age=60')
  res.json(Object.fromEntries(publicSettingKeys.map((k) => [k, all[k]])))
})

// Published gallery photos for the website, in display order.
publicRoutes.get('/gallery', async (req, res) => {
  const rows = await listGallery()
  res.json(rows.map((r) => ({ id: String(r._id), src: r.src, caption: r.caption, category: r.category })))
})

const verifyLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 60 })

// Only the minimum needed to confirm authenticity is disclosed.
publicRoutes.get('/verify/:code', verifyLimiter, async (req, res) => {
  const code = String(req.params.code).trim().toUpperCase()
  if (!/^[A-Z0-9-]{6,40}$/.test(code)) throw badRequest('Enter a valid verification code')

  const cert = await Certificate.findOne({ $or: [{ verification_code: code }, { serial: code }] }).lean()
  if (cert) {
    const s = await Student.findById(cert.student_id, 'first_name last_name student_number').lean()
    return res.json({
      type: 'certificate',
      valid: !cert.revoked_at,
      status: cert.revoked_at ? 'revoked' : 'valid',
      holder: `${s.first_name} ${s.last_name}`,
      studentNumber: s.student_number,
      title: cert.title,
      grade: cert.grade,
      issuedOn: cert.issued_on,
      serial: cert.serial,
    })
  }

  const doc = await DocumentVerification.findOne({ code }).lean()
  if (doc) {
    const s = await Student.findById(doc.student_id, 'first_name last_name student_number').lean()
    if (s) {
      return res.json({
        type: doc.kind,
        valid: true,
        status: 'valid',
        holder: `${s.first_name} ${s.last_name}`,
        studentNumber: s.student_number,
        issuedOn: doc.created_at,
        summary: doc.snapshot?.summary ?? null,
        programme: doc.snapshot?.programme ?? null,
      })
    }
  }
  throw notFoundError('No certificate or document matches this code')
})

publicRoutes.get('/verify-student/:number', verifyLimiter, async (req, res) => {
  const s = await Student.findOne({ student_number: new RegExp(`^${escapeRegex(req.params.number)}$`, 'i') }).lean()
  if (!s) throw notFoundError('No student matches this ID')
  const p = s.programme_id ? await Programme.findById(s.programme_id, 'name').lean() : null
  res.json({ holder: `${s.first_name} ${s.last_name}`, studentNumber: s.student_number, status: s.status, programme: p?.name ?? null })
})
