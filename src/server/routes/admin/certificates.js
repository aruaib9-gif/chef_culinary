// Certificates with unique serials, verification codes and QR (spec §9.3, §11 "Certificate verification").
import { z } from 'zod'
import { Certificate, Student, Programme, Cohort, Result, User } from '../../db/models.js'
import { withTransaction } from '../../db/mongo.js'
import { gradeFor } from '../../../shared/grading.js'
import { parse, idParam, id, optionalText, optionalDate, requiredText } from '../../lib/validate.js'
import { verificationCode } from '../../lib/security.js'
import { getGradingScheme } from '../../lib/settings.js'
import { nextCertificateSerial } from '../../lib/sequence.js'
import { certificatePdf } from '../../lib/pdf.js'
import { sendMail, layout } from '../../lib/mailer.js'
import { audit } from '../../lib/audit.js'
import { byIds, pick, contains } from '../../lib/lookup.js'
import { config } from '../../config.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { Router, badRequest, notFoundError } from '../../http.js'

export const certificates = new Router()

certificates.get('/', async (req, res) => {
  const { q, cohortId } = parse(z.object({ q: z.string().max(100).optional(), cohortId: id.optional() }), req.query)
  const filter = {}
  if (cohortId) filter.cohort_id = cohortId
  if (q) {
    const re = contains(q)
    const sids = (await Student.find({ $or: [{ first_name: re }, { last_name: re }, { student_number: re }] }, '_id').lean()).map((s) => s._id)
    filter.$or = [{ serial: re }, { student_id: { $in: sids } }]
  }
  const rows = await Certificate.find(filter).sort({ issued_on: -1, _id: -1 }).limit(500).lean()
  const [students, cohorts] = await Promise.all([
    byIds(Student, rows.map((c) => c.student_id), 'student_number first_name last_name'),
    byIds(Cohort, rows.map((c) => c.cohort_id), 'name'),
  ])
  res.json(rows.map((c) => ({
    ...c, student_number: pick(students, c.student_id, 'student_number'), first_name: pick(students, c.student_id, 'first_name'),
    last_name: pick(students, c.student_id, 'last_name'), cohort_name: pick(cohorts, c.cohort_id, 'name'),
  })))
})

// Overall grade = grade band of the average of the student's published course totals in the cohort.
async function overallGrade(studentId, cohortId, session) {
  if (!cohortId) return null
  const totals = await Result.find({ student_id: studentId, cohort_id: cohortId, status: 'published' }, 'total').session(session ?? null).lean()
  if (!totals.length) return null
  const avg = totals.reduce((s, r) => s + r.total, 0) / totals.length
  return gradeFor(avg, (await getGradingScheme()).definition).grade
}

async function issue(session, req, { studentId, title, grade, issuedOn }) {
  const s = await Student.findById(studentId).session(session).lean()
  if (!s) throw notFoundError('Student not found')
  const p = s.programme_id ? await Programme.findById(s.programme_id, 'name certificate_awarded').session(session).lean() : null
  const [row] = await Certificate.create([{
    student_id: s._id, programme_id: s.programme_id, cohort_id: s.cohort_id,
    title: title || p?.certificate_awarded || p?.name || 'Culinary Programme',
    grade: grade ?? (await overallGrade(s._id, s.cohort_id, session)),
    issued_on: issuedOn ?? new Date().toISOString().slice(0, 10),
    serial: await nextCertificateSerial(session), verification_code: verificationCode(10), created_by: req.user.id,
  }], { session })
  await audit(req, 'certificate.issue', 'certificate', row._id, { studentId: String(s._id), serial: row.serial }, session)
  return row.toObject()
}

const issueSchema = z.object({ studentId: id, title: optionalText(200), grade: optionalText(10), issuedOn: optionalDate })

certificates.post('/', requireSuperAdmin, async (req, res) => {
  const b = parse(issueSchema, req.body)
  res.status(201).json(await withTransaction((session) => issue(session, req, b)))
})

// Issues certificates to every student in a cohort who doesn't already hold one for that cohort.
certificates.post('/bulk', requireSuperAdmin, async (req, res) => {
  const b = parse(z.object({ cohortId: id, issuedOn: optionalDate, markGraduated: z.boolean().default(true) }), req.body)
  const created = await withTransaction(async (session) => {
    const holders = await Certificate.distinct('student_id', { cohort_id: b.cohortId, revoked_at: null }).session(session)
    const students = await Student.find({ cohort_id: b.cohortId, status: { $in: ['active', 'graduated'] }, _id: { $nin: holders } }, '_id').session(session).lean()
    const out = []
    for (const s of students) out.push(await issue(session, req, { studentId: s._id, issuedOn: b.issuedOn }))
    if (b.markGraduated && out.length) {
      const today = new Date().toISOString().slice(0, 10)
      await Student.updateMany({ _id: { $in: students.map((s) => s._id) } }, [{ $set: { status: 'graduated', graduated_on: { $ifNull: ['$graduated_on', today] } } }], { session })
    }
    return out
  })
  res.status(201).json({ issued: created.length })
})

certificates.post('/:id/revoke', requireSuperAdmin, async (req, res) => {
  const { reason } = parse(z.object({ reason: requiredText(500) }), req.body)
  const row = await Certificate.findOneAndUpdate({ _id: idParam(req), revoked_at: null }, { $set: { revoked_at: new Date(), revoke_reason: reason } }, { returnDocument: 'after' }).lean()
  if (!row) throw badRequest('Certificate not found or already revoked')
  await audit(req, 'certificate.revoke', 'certificate', row._id, { reason })
  res.json(row)
})

async function load(certId) {
  const cert = await Certificate.findById(certId).lean()
  if (!cert) throw notFoundError()
  const student = await Student.findById(cert.student_id).lean()
  const login = student?.user_id ? await User.findById(student.user_id, 'email').lean() : null
  return { cert, student: { ...student, login_email: login?.email ?? null } }
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
