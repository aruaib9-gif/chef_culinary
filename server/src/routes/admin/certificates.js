// Certificates with unique serials, verification codes and QR (spec §9.3, §11 "Certificate verification").
import { Router } from 'express'
import { z } from 'zod'
import { many, one, tx } from '../../db/pool.js'
import { gradeFor } from '@cca/shared/grading'
import { parse, idParam, id, optionalText, optionalDate, requiredText } from '../../lib/validate.js'
import { verificationCode } from '../../lib/security.js'
import { getGradingScheme } from '../../lib/settings.js'
import { certificatePdf } from '../../lib/pdf.js'
import { sendMail, layout } from '../../lib/mailer.js'
import { audit } from '../../lib/audit.js'
import { config } from '../../config.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { badRequest, notFoundError } from '../../middleware/errors.js'

export const certificates = Router()

certificates.get('/', async (req, res) => {
  const { q, cohortId } = parse(z.object({ q: z.string().max(100).optional(), cohortId: id.optional() }), req.query)
  const params = []
  const where = []
  if (q) where.push(`(s.first_name || ' ' || s.last_name ILIKE $${params.push(`%${q}%`)} OR c.serial ILIKE $${params.length} OR s.student_number ILIKE $${params.length})`)
  if (cohortId) where.push(`c.cohort_id = $${params.push(cohortId)}`)
  res.json(await many(
    `SELECT c.*, s.student_number, s.first_name, s.last_name, co.name AS cohort_name
       FROM certificates c JOIN students s ON s.id = c.student_id LEFT JOIN cohorts co ON co.id = c.cohort_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.issued_on DESC, c.id DESC LIMIT 500`,
    params,
  ))
})

// Overall grade = grade band of the average of the student's published course totals in the cohort.
async function overallGrade(t, studentId, cohortId) {
  if (!cohortId) return null
  const r = await t.one(`SELECT AVG(total)::float AS avg FROM results WHERE student_id = $1 AND cohort_id = $2 AND status = 'published'`, [studentId, cohortId])
  if (r?.avg == null) return null
  return gradeFor(r.avg, (await getGradingScheme(t)).definition).grade
}

async function issue(t, req, { studentId, title, grade, issuedOn }) {
  const s = await t.one(
    `SELECT s.*, p.name AS programme_name, p.certificate_awarded FROM students s LEFT JOIN programmes p ON p.id = s.programme_id WHERE s.id = $1`,
    [studentId],
  )
  if (!s) throw notFoundError('Student not found')
  const { n } = await t.one(`SELECT nextval('certificate_serial_seq') AS n`)
  const serial = `CCA-${new Date().getFullYear()}-${String(n).padStart(5, '0')}`
  const row = await t.one(
    `INSERT INTO certificates (student_id, programme_id, cohort_id, title, grade, issued_on, serial, verification_code, created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7,$8,$9) RETURNING *`,
    [s.id, s.programme_id, s.cohort_id, title || s.certificate_awarded || s.programme_name || 'Culinary Programme',
      grade ?? (await overallGrade(t, s.id, s.cohort_id)), issuedOn ?? null, serial, verificationCode(10), req.user.id],
  )
  await audit(req, 'certificate.issue', 'certificate', row.id, { studentId: s.id, serial }, t)
  return row
}

const issueSchema = z.object({ studentId: id, title: optionalText(200), grade: optionalText(10), issuedOn: optionalDate })

certificates.post('/', requireSuperAdmin, async (req, res) => {
  const b = parse(issueSchema, req.body)
  res.status(201).json(await tx((t) => issue(t, req, b)))
})

// Issues certificates to every student in a cohort who doesn't already hold one for that cohort.
certificates.post('/bulk', requireSuperAdmin, async (req, res) => {
  const b = parse(z.object({ cohortId: id, issuedOn: optionalDate, markGraduated: z.boolean().default(true) }), req.body)
  const created = await tx(async (t) => {
    const students = await t.many(
      `SELECT id FROM students WHERE cohort_id = $1 AND status IN ('active', 'graduated')
          AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.student_id = students.id AND c.cohort_id = $1 AND c.revoked_at IS NULL)`,
      [b.cohortId],
    )
    const out = []
    for (const s of students) out.push(await issue(t, req, { studentId: s.id, issuedOn: b.issuedOn }))
    if (b.markGraduated && out.length) {
      await t.query(`UPDATE students SET status = 'graduated', graduated_on = COALESCE(graduated_on, CURRENT_DATE) WHERE id = ANY($1)`, [students.map((s) => s.id)])
    }
    return out
  })
  res.status(201).json({ issued: created.length })
})

certificates.post('/:id/revoke', requireSuperAdmin, async (req, res) => {
  const { reason } = parse(z.object({ reason: requiredText(500) }), req.body)
  const row = await one('UPDATE certificates SET revoked_at = now(), revoke_reason = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING *', [idParam(req), reason])
  if (!row) throw badRequest('Certificate not found or already revoked')
  await audit(req, 'certificate.revoke', 'certificate', row.id, { reason })
  res.json(row)
})

async function load(certId) {
  const cert = await one('SELECT * FROM certificates WHERE id = $1', [certId])
  if (!cert) throw notFoundError()
  const student = await one('SELECT s.*, u.email AS login_email FROM students s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = $1', [cert.student_id])
  return { cert, student }
}

certificates.get('/:id/pdf', async (req, res) => {
  const { cert, student } = await load(idParam(req))
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="certificate-${cert.serial}.pdf"`)
  res.send(await certificatePdf({ certificate: cert, student }))
})

certificates.post('/:id/email', async (req, res) => {
  const { cert, student } = await load(idParam(req))
  const to = student.login_email ?? student.email
  if (!to) throw badRequest('This student has no email address')
  const pdf = await certificatePdf({ certificate: cert, student })
  await sendMail({
    to,
    sentBy: req.user.id,
    subject: 'Your certificate from The Chefs Culinary Academy',
    html: layout({ heading: `Congratulations, ${student.first_name}!`, paragraphs: [`Your certificate (${cert.serial}) is attached. Employers can verify it at ${config.webUrl}/verify using code ${cert.verification_code}.`] }),
    attachments: [{ filename: `certificate-${cert.serial}.pdf`, content: pdf }],
  })
  res.json({ ok: true })
})

