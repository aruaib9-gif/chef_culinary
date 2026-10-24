// Admissions review: filter, comment, decide, admission letter, one-click conversion to student (spec §7).
import { Router } from 'express'
import { z } from 'zod'
import { many, one, tx, db } from '../../db/pool.js'
import { config } from '../../config.js'
import { parse, idParam, pagination, paged, requiredText, optionalText, id } from '../../lib/validate.js'
import { sendFile } from '../../lib/files.js'
import { admissionLetterPdf } from '../../lib/pdf.js'
import { sendMail, layout } from '../../lib/mailer.js'
import { audit } from '../../lib/audit.js'
import { nextStudentNumber, raiseTuitionCharges } from '../../lib/students.js'
import { presentApplication } from '../applications.js'
import { HttpError, badRequest, notFoundError } from '../../middleware/errors.js'

export const applications = Router()

const STATUSES = ['received', 'under_review', 'admitted', 'declined', 'waitlisted', 'enrolled']

applications.get('/', async (req, res) => {
  const f = parse(pagination.extend({ status: z.enum([...STATUSES, 'draft']).optional().or(z.literal('')), programmeId: id.optional().or(z.literal('')) }), req.query)
  const params = []
  const clauses = [f.status ? `a.status = $${params.push(f.status)}` : `a.status <> 'draft'`]
  if (f.programmeId) clauses.push(`a.programme_id = $${params.push(f.programmeId)}`)
  if (f.q) clauses.push(`(a.reference ILIKE $${params.push(`%${f.q}%`)} OR a.data->'personal'->>'fullName' ILIKE $${params.length} OR u.email ILIKE $${params.length})`)
  const rows = await many(
    `SELECT a.id, a.reference, a.status, a.submitted_at, a.updated_at, a.data->'personal'->>'fullName' AS full_name,
            a.data->'personal'->>'phone' AS phone, u.email, p.name AS programme_name, c.name AS cohort_name,
            COUNT(*) OVER() AS total_count
       FROM applications a JOIN users u ON u.id = a.user_id
       LEFT JOIN programmes p ON p.id = a.programme_id LEFT JOIN cohorts c ON c.id = a.cohort_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY a.submitted_at DESC NULLS LAST, a.updated_at DESC
      LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
    params,
  )
  const statusCounts = await many(`SELECT status, COUNT(*)::int AS n FROM applications GROUP BY status`)
  res.json({ ...paged(rows, f), statusCounts })
})

async function loadApplication(appId) {
  const app = await one('SELECT * FROM applications WHERE id = $1', [appId])
  if (!app) throw notFoundError('Application not found')
  return app
}

applications.get('/:id', async (req, res) => {
  const app = await loadApplication(idParam(req))
  const [detail, user, notes, cohort, student] = await Promise.all([
    presentApplication(app),
    one('SELECT id, email, full_name, phone, created_at FROM users WHERE id = $1', [app.user_id]),
    many(`SELECT n.id, n.body, n.created_at, u.full_name AS author FROM application_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.application_id = $1 ORDER BY n.created_at`, [app.id]),
    app.cohort_id ? one('SELECT id, name FROM cohorts WHERE id = $1', [app.cohort_id]) : null,
    app.student_id ? one('SELECT id, student_number FROM students WHERE id = $1', [app.student_id]) : null,
  ])
  res.json({ ...detail, programmeId: app.programme_id, cohort, applicant: user, notes, student })
})

applications.get('/:id/documents/:fileId', async (req, res) => {
  const ok = await one('SELECT 1 FROM application_documents WHERE application_id = $1 AND file_id = $2', [idParam(req), idParam(req, 'fileId')])
  if (!ok) throw notFoundError()
  await sendFile(res, db, idParam(req, 'fileId'))
})

applications.post('/:id/notes', async (req, res) => {
  const { body } = parse(z.object({ body: requiredText(5000) }), req.body)
  const app = await loadApplication(idParam(req))
  const note = await one('INSERT INTO application_notes (application_id, author_id, body) VALUES ($1, $2, $3) RETURNING *', [app.id, req.user.id, body])
  res.status(201).json({ ...note, author: req.user.full_name })
})

const STATUS_EMAIL = {
  under_review: ['Your application is under review', 'Our admissions team is now reviewing your application. We will let you know the outcome soon.'],
  waitlisted: ['Application update: waitlisted', 'Thank you for your patience. Your application has been placed on our waiting list for the next available place. We will contact you as soon as a place opens.'],
  declined: ['Application update', 'Thank you for your interest in The Chefs Culinary Academy. After careful review we are unable to offer you a place at this time. You are welcome to apply for a future intake.'],
}

applications.patch('/:id/status', async (req, res) => {
  const b = parse(z.object({ status: z.enum(['received', 'under_review', 'waitlisted', 'declined']), message: optionalText(3000), notify: z.boolean().default(true) }), req.body)
  const app = await loadApplication(idParam(req))
  if (['enrolled', 'draft'].includes(app.status)) throw badRequest(`Cannot change the status of a ${app.status} application`)
  const updated = await one(
    `UPDATE applications SET status = $2, decided_at = CASE WHEN $2 IN ('declined','waitlisted') THEN now() ELSE decided_at END,
            decided_by = $3, updated_at = now() WHERE id = $1 RETURNING *`,
    [app.id, b.status, req.user.id],
  )
  await audit(req, 'application.status', 'application', app.id, { from: app.status, to: b.status })
  if (b.notify && STATUS_EMAIL[b.status]) {
    const user = await one('SELECT email, full_name FROM users WHERE id = $1', [app.user_id])
    const [subject, text] = STATUS_EMAIL[b.status]
    sendMail({ to: user.email, subject, sentBy: req.user.id, html: layout({ heading: subject, paragraphs: [`Dear ${user.full_name.split(' ')[0]},`, text, b.message ?? '', `Reference: ${app.reference}`].filter(Boolean), action: { label: 'View in portal', url: `${config.webUrl}/portal` } }) })
  }
  res.json(updated)
})

async function letterFor(app) {
  const programme = await one('SELECT * FROM programmes WHERE id = $1', [app.programme_id])
  const cohort = app.cohort_id ? await one('SELECT * FROM cohorts WHERE id = $1', [app.cohort_id]) : null
  const student = app.student_id ? await one('SELECT student_number FROM students WHERE id = $1', [app.student_id]) : null
  return admissionLetterPdf({ application: app, programme, cohort, studentNumber: student?.student_number })
}

// Admit: sets the cohort, emails the admission letter. Optionally enrols in the same step.
applications.post('/:id/admit', async (req, res) => {
  const b = parse(z.object({ cohortId: id.optional().nullable(), enrol: z.boolean().default(false), message: optionalText(3000) }), req.body)
  const app = await loadApplication(idParam(req))
  if (!['received', 'under_review', 'waitlisted', 'declined'].includes(app.status)) throw badRequest(`This application is already ${app.status}`)
  if (b.cohortId) await assertCohortForProgramme(b.cohortId, app.programme_id)
  let updated = await one(
    `UPDATE applications SET status = 'admitted', cohort_id = COALESCE($2, cohort_id), decided_at = now(), decided_by = $3, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [app.id, b.cohortId ?? null, req.user.id],
  )
  await audit(req, 'application.admit', 'application', app.id, { cohortId: b.cohortId })
  if (b.enrol) updated = (await enrol(req, updated)).application

  const user = await one('SELECT email, full_name FROM users WHERE id = $1', [app.user_id])
  const pdf = await letterFor(updated)
  sendMail({
    to: user.email,
    sentBy: req.user.id,
    subject: 'Offer of admission — The Chefs Culinary Academy',
    html: layout({
      heading: 'Congratulations — you have been admitted!',
      paragraphs: [`Dear ${user.full_name.split(' ')[0]},`, 'We are delighted to offer you admission. Your admission letter is attached.', b.message ?? ''].filter(Boolean),
      action: { label: 'Open your portal', url: `${config.webUrl}/portal` },
    }),
    attachments: [{ filename: `admission-letter-${updated.reference}.pdf`, content: pdf }],
  })
  res.json(updated)
})

applications.post('/:id/enrol', async (req, res) => {
  const b = parse(z.object({ cohortId: id.optional().nullable() }), req.body)
  let app = await loadApplication(idParam(req))
  if (app.status !== 'admitted') throw badRequest('Only admitted applications can be enrolled')
  if (b.cohortId) {
    await assertCohortForProgramme(b.cohortId, app.programme_id)
    app = await one('UPDATE applications SET cohort_id = $2 WHERE id = $1 RETURNING *', [app.id, b.cohortId])
  }
  const result = await enrol(req, app)
  res.json(result)
})

async function assertCohortForProgramme(cohortId, programmeId) {
  const c = await one('SELECT programme_id FROM cohorts WHERE id = $1', [cohortId])
  if (!c) throw badRequest('Cohort not found')
  if (c.programme_id !== programmeId) throw badRequest('That cohort belongs to a different programme')
}

// Converts an admitted applicant into a student: record, student ID, role change, tuition charges (spec §7).
async function enrol(req, app) {
  if (!app.cohort_id) throw badRequest('Choose a cohort before enrolling', { cohortId: 'Required' })
  const result = await tx(async (t) => {
    const locked = await t.one('SELECT * FROM applications WHERE id = $1 FOR UPDATE', [app.id])
    if (locked.student_id) throw new HttpError(409, 'This applicant is already enrolled')
    const user = await t.one('SELECT * FROM users WHERE id = $1', [app.user_id])
    const existing = await t.one('SELECT * FROM students WHERE user_id = $1', [user.id])
    const p = app.data.personal ?? {}
    const g = app.data.guardian ?? {}
    const [first, ...rest] = (p.fullName || user.full_name || 'Student').trim().split(/\s+/)
    const photo = await t.one(`SELECT file_id FROM application_documents WHERE application_id = $1 AND kind = 'photo'`, [app.id])

    let student
    if (existing) {
      // A current/former student applying again: move them to the new programme and cohort.
      student = await t.one(
        `UPDATE students SET programme_id = $2, cohort_id = $3, status = 'active', application_id = $4, updated_at = now() WHERE id = $1 RETURNING *`,
        [existing.id, app.programme_id, app.cohort_id, app.id],
      )
    } else {
      student = await t.one(
        `INSERT INTO students (user_id, student_number, first_name, last_name, email, phone, gender, date_of_birth, address, city, state,
                               guardian_name, guardian_phone, guardian_relationship, sponsor, photo_file_id, programme_id, cohort_id, application_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [
          user.id, await nextStudentNumber(t), first, rest.join(' ') || '-', user.email, p.phone || user.phone, p.gender || null,
          p.dob || null, p.address || null, p.city || null, p.state || null, g.name || null, g.phone || null, g.relationship || null,
          g.sponsor || null, photo?.file_id ?? null, app.programme_id, app.cohort_id, app.id,
        ],
      )
      await t.query(`UPDATE users SET role = 'student', updated_at = now() WHERE id = $1 AND role = 'applicant'`, [user.id])
    }
    const charges = await raiseTuitionCharges(t, { studentId: student.id, programmeId: app.programme_id, cohortId: app.cohort_id, userId: req.user.id })
    const application = await t.one(`UPDATE applications SET status = 'enrolled', student_id = $2, updated_at = now() WHERE id = $1 RETURNING *`, [app.id, student.id])
    await t.query(`UPDATE leads SET status = 'enrolled', updated_at = now() WHERE lower(email) = lower($1) AND status <> 'enrolled'`, [user.email])
    await audit(req, 'application.enrol', 'application', app.id, { studentId: student.id, studentNumber: student.student_number }, t)
    return { application, student, charges, user }
  })

  sendMail({
    to: result.user.email,
    sentBy: req.user.id,
    subject: `Welcome! Your student ID is ${result.student.student_number}`,
    html: layout({
      heading: 'You are now enrolled',
      paragraphs: [
        `Dear ${result.student.first_name}, welcome to The Chefs Culinary Academy.`,
        `Your student ID is ${result.student.student_number}. You can sign in to the student portal with this ID or your email address, using your existing password.`,
        'In the portal you will find your timetable, fees and payment options, learning materials, notices and results.',
      ],
      action: { label: 'Open the student portal', url: `${config.webUrl}/portal` },
    }),
  })
  return { application: result.application, student: result.student, charges: result.charges.length }
}

applications.get('/:id/admission-letter.pdf', async (req, res) => {
  const app = await loadApplication(idParam(req))
  if (!['admitted', 'enrolled'].includes(app.status)) throw badRequest('Admission letters are only available for admitted applicants')
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="admission-letter-${app.reference}.pdf"`)
  res.send(await letterFor(app))
})
