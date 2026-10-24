// Unauthenticated endpoints: public settings and certificate / result verification (spec §9.3, §11).
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { one } from '../db/pool.js'
import { getSettings, publicSettingKeys } from '../lib/settings.js'
import { badRequest, notFoundError } from '../middleware/errors.js'

export const publicRoutes = Router()

publicRoutes.get('/settings', async (req, res) => {
  const all = await getSettings()
  res.set('Cache-Control', 'public, max-age=60')
  res.json(Object.fromEntries(publicSettingKeys.map((k) => [k, all[k]])))
})

const verifyLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 60 })

// Only the minimum needed to confirm authenticity is disclosed.
publicRoutes.get('/verify/:code', verifyLimiter, async (req, res) => {
  const code = String(req.params.code).trim().toUpperCase()
  if (!/^[A-Z0-9-]{6,40}$/.test(code)) throw badRequest('Enter a valid verification code')

  const cert = await one(
    `SELECT c.title, c.grade, c.issued_on, c.serial, c.revoked_at, s.first_name, s.last_name, s.student_number
       FROM certificates c JOIN students s ON s.id = c.student_id
      WHERE c.verification_code = $1 OR upper(c.serial) = $1`,
    [code],
  )
  if (cert) {
    return res.json({
      type: 'certificate',
      valid: !cert.revoked_at,
      status: cert.revoked_at ? 'revoked' : 'valid',
      holder: `${cert.first_name} ${cert.last_name}`,
      studentNumber: cert.student_number,
      title: cert.title,
      grade: cert.grade,
      issuedOn: cert.issued_on,
      serial: cert.serial,
    })
  }

  const doc = await one(
    `SELECT d.kind, d.created_at, d.snapshot, s.first_name, s.last_name, s.student_number
       FROM document_verifications d JOIN students s ON s.id = d.student_id WHERE d.code = $1`,
    [code],
  )
  if (doc) {
    return res.json({
      type: doc.kind,
      valid: true,
      status: 'valid',
      holder: `${doc.first_name} ${doc.last_name}`,
      studentNumber: doc.student_number,
      issuedOn: doc.created_at,
      summary: doc.snapshot?.summary ?? null,
      programme: doc.snapshot?.programme ?? null,
    })
  }
  throw notFoundError('No certificate or document matches this code')
})

publicRoutes.get('/verify-student/:number', verifyLimiter, async (req, res) => {
  const s = await one(
    `SELECT s.first_name, s.last_name, s.student_number, s.status, p.name AS programme
       FROM students s LEFT JOIN programmes p ON p.id = s.programme_id WHERE upper(s.student_number) = upper($1)`,
    [req.params.number],
  )
  if (!s) throw notFoundError('No student matches this ID')
  res.json({ holder: `${s.first_name} ${s.last_name}`, studentNumber: s.student_number, status: s.status, programme: s.programme })
})
