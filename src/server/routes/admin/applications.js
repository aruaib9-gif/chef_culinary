// Admissions review: filter, comment, decide, admission letter, one-click conversion to student (spec §7).
import { z } from 'zod'
import { Application, User, Programme, Cohort, Student, Lead } from '../../db/models.js'
import { withTransaction } from '../../db/mongo.js'
import { config } from '../../config.js'
import { parse, idParam, pagination, paged, requiredText, optionalText, id } from '../../lib/validate.js'
import { sendFile } from '../../lib/storage.js'
import { admissionLetterPdf } from '../../lib/pdf.js'
import { sendMail, layout } from '../../lib/mailer.js'
import { audit } from '../../lib/audit.js'
import { nextStudentNumber, raiseTuitionCharges } from '../../lib/students.js'
import { byIds, pick, contains } from '../../lib/lookup.js'
import { presentApplication } from '../applications.js'
import { Router, HttpError, badRequest, notFoundError, defer } from '../../http.js'

export const applications = new Router()

const STATUSES = ['received', 'under_review', 'admitted', 'declined', 'waitlisted', 'enrolled']

applications.get('/', async (req, res) => {
  const f = parse(pagination.extend({ status: z.enum([...STATUSES, 'draft']).optional().or(z.literal('')), programmeId: id.optional().or(z.literal('')) }), req.query)
  const q = f.status ? { status: f.status } : { status: { $ne: 'draft' } }
  if (f.programmeId) q.programme_id = f.programmeId
  if (f.q) {
    const re = contains(f.q)
    const users = await User.find({ email: re }, '_id').lean()
    q.$or = [{ reference: re }, { 'data.personal.fullName': re }, { user_id: { $in: users.map((u) => u._id) } }]
  }
  const [rows, total, statusCounts] = await Promise.all([
    Application.find(q).sort({ submitted_at: -1, updated_at: -1 }).skip((f.page - 1) * f.pageSize).limit(f.pageSize).lean(),
    Application.countDocuments(q),
    Application.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ])
  const [users, programmes, cohorts] = await Promise.all([
    byIds(User, rows.map((a) => a.user_id), 'email'),
    byIds(Programme, rows.map((a) => a.programme_id), 'name'),
    byIds(Cohort, rows.map((a) => a.cohort_id), 'name'),
  ])
  const items = rows.map((a) => ({
    id: a._id, reference: a.reference, status: a.status, submitted_at: a.submitted_at, updated_at: a.updated_at,
    full_name: a.data?.personal?.fullName ?? null, phone: a.data?.personal?.phone ?? null, email: pick(users, a.user_id, 'email'),
    programme_name: pick(programmes, a.programme_id, 'name'), cohort_name: pick(cohorts, a.cohort_id, 'name'),
  }))
  res.json({ ...paged(items, total, f), statusCounts: statusCounts.map((s) => ({ status: s._id, n: s.n })) })
})

async function loadApplication(appId) {
  const app = await Application.findById(appId).lean()
  if (!app) throw notFoundError('Application not found')
  return app
}

applications.get('/:id', async (req, res) => {
  const app = await loadApplication(idParam(req))
  const [detail, user, cohort, student, authors] = await Promise.all([
    presentApplication(app),
    User.findById(app.user_id, 'email full_name phone created_at').lean(),
    app.cohort_id ? Cohort.findById(app.cohort_id, 'name').lean() : null,
    app.student_id ? Student.findById(app.student_id, 'student_number').lean() : null,
    byIds(User, (app.notes ?? []).map((n) => n.author_id), 'full_name'),
  ])
  res.json({
    ...detail,
    programmeId: app.programme_id ? String(app.programme_id) : null,
    cohort,
    applicant: user,
    notes: (app.notes ?? []).map((n) => ({ id: n._id, body: n.body, created_at: n.created_at, author: pick(authors, n.author_id, 'full_name') })),
    student,
  })
})

applications.get('/:id/documents/:fileId', async (req, res) => {
  const ok = await Application.exists({ _id: idParam(req), 'documents.file_id': idParam(req, 'fileId') })
  if (!ok) throw notFoundError()
  await sendFile(res, idParam(req, 'fileId'))
})

applications.post('/:id/notes', async (req, res) => {
  const { body } = parse(z.object({ body: requiredText(5000) }), req.body)
  const app = await Application.findByIdAndUpdate(
    idParam(req),
    { $push: { notes: { author_id: req.user.id, body } } },
    { returnDocument: 'after', projection: { notes: { $slice: -1 } } },
  ).lean()
  if (!app) throw notFoundError('Application not found')
  const note = app.notes[0]
  res.status(201).json({ id: note._id, body: note.body, created_at: note.created_at, author: req.user.full_name })
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
  const set = { status: b.status, decided_by: req.user.id }
  if (['declined', 'waitlisted'].includes(b.status)) set.decided_at = new Date()
  const updated = await Application.findByIdAndUpdate(app._id, { $set: set }, { returnDocument: 'after' }).lean()
  await audit(req, 'application.status', 'application', app._id, { from: app.status, to: b.status })
  if (b.notify && STATUS_EMAIL[b.status]) {
    const user = await User.findById(app.user_id, 'email full_name').lean()
    const [subject, text] = STATUS_EMAIL[b.status]
    defer(() => sendMail({ to: user.email, subject, sentBy: req.user.id, html: layout({ heading: subject, paragraphs: [`Dear ${user.full_name.split(' ')[0]},`, text, b.message ?? '', `Reference: ${app.reference}`].filter(Boolean), action: { label: 'View in portal', url: `${config.webUrl}/portal` } }) }))
  }
  res.json(updated)
})

async function letterFor(app) {
  const [programme, cohort, student] = await Promise.all([
    Programme.findById(app.programme_id).lean(),
    app.cohort_id ? Cohort.findById(app.cohort_id).lean() : null,
    app.student_id ? Student.findById(app.student_id, 'student_number').lean() : null,
  ])
  return admissionLetterPdf({ application: app, programme, cohort, studentNumber: student?.student_number })
}

// Admit: sets the cohort, emails the admission letter. Optionally enrols in the same step.
applications.post('/:id/admit', async (req, res) => {
  const b = parse(z.object({ cohortId: id.optional().nullable(), enrol: z.boolean().default(false), message: optionalText(3000) }), req.body)
  const app = await loadApplication(idParam(req))
  if (!['received', 'under_review', 'waitlisted', 'declined'].includes(app.status)) throw badRequest(`This application is already ${app.status}`)
  if (b.cohortId) await assertCohortForProgramme(b.cohortId, app.programme_id)
  const set = { status: 'admitted', decided_at: new Date(), decided_by: req.user.id }
  if (b.cohortId) set.cohort_id = b.cohortId
  let updated = await Application.findByIdAndUpdate(app._id, { $set: set }, { returnDocument: 'after' }).lean()
  await audit(req, 'application.admit', 'application', app._id, { cohortId: b.cohortId })
  if (b.enrol) updated = (await enrol(req, updated)).application

  const user = await User.findById(app.user_id, 'email full_name').lean()
  const letterApp = updated
  defer(async () => {
    const pdf = await letterFor(letterApp)
    await sendMail({
      to: user.email,
      sentBy: req.user.id,
      subject: 'Offer of admission — The Chefs Culinary Academy',
      html: layout({
        heading: 'Congratulations — you have been admitted!',
        paragraphs: [`Dear ${user.full_name.split(' ')[0]},`, 'We are delighted to offer you admission. Your admission letter is attached.', b.message ?? ''].filter(Boolean),
        action: { label: 'Open your portal', url: `${config.webUrl}/portal` },
      }),
      attachments: [{ filename: `admission-letter-${letterApp.reference}.pdf`, content: pdf }],
    })
  })
  res.json(updated)
})

applications.post('/:id/enrol', async (req, res) => {
  const b = parse(z.object({ cohortId: id.optional().nullable() }), req.body)
  let app = await loadApplication(idParam(req))
  if (app.status !== 'admitted') throw badRequest('Only admitted applications can be enrolled')
  if (b.cohortId) {
    await assertCohortForProgramme(b.cohortId, app.programme_id)
    app = await Application.findByIdAndUpdate(app._id, { $set: { cohort_id: b.cohortId } }, { returnDocument: 'after' }).lean()
  }
  res.json(await enrol(req, app))
})

async function assertCohortForProgramme(cohortId, programmeId) {
  const c = await Cohort.findById(cohortId, 'programme_id').lean()
  if (!c) throw badRequest('Cohort not found')
  if (String(c.programme_id) !== String(programmeId)) throw badRequest('That cohort belongs to a different programme')
}

// Converts an admitted applicant into a student: record, student ID, role change, tuition charges (spec §7).
async function enrol(req, app) {
  if (!app.cohort_id) throw badRequest('Choose a cohort before enrolling', { cohortId: 'Required' })
  const result = await withTransaction(async (session) => {
    const current = await Application.findById(app._id).session(session).lean()
    if (current.student_id) throw new HttpError(409, 'This applicant is already enrolled')
    const user = await User.findById(app.user_id).session(session).lean()
    const existing = await Student.findOne({ user_id: user._id }).session(session).lean()
    const p = app.data?.personal ?? {}
    const g = app.data?.guardian ?? {}
    const [first, ...rest] = (p.fullName || user.full_name || 'Student').trim().split(/\s+/)
    const photo = (app.documents ?? []).find((d) => d.kind === 'photo')

    let student
    if (existing) {
      // A current/former student applying again: move them to the new programme and cohort.
      student = await Student.findByIdAndUpdate(
        existing._id,
        { $set: { programme_id: app.programme_id, cohort_id: app.cohort_id, status: 'active', application_id: app._id } },
        { returnDocument: 'after', session },
      ).lean()
    } else {
      ;[student] = await Student.create([{
        user_id: user._id, student_number: await nextStudentNumber(session), first_name: first, last_name: rest.join(' ') || '-',
        email: user.email, phone: p.phone || user.phone, gender: p.gender || null, date_of_birth: p.dob || null, address: p.address || null,
        city: p.city || null, state: p.state || null, guardian_name: g.name || null, guardian_phone: g.phone || null,
        guardian_relationship: g.relationship || null, sponsor: g.sponsor || null, photo_file_id: photo?.file_id ?? null,
        programme_id: app.programme_id, cohort_id: app.cohort_id, application_id: app._id,
      }], { session })
      student = student.toObject()
      await User.updateOne({ _id: user._id, role: 'applicant' }, { $set: { role: 'student' } }, { session })
    }
    const charges = await raiseTuitionCharges(session, { studentId: student._id, programmeId: app.programme_id, cohortId: app.cohort_id, userId: req.user.id })
    const application = await Application.findByIdAndUpdate(app._id, { $set: { status: 'enrolled', student_id: student._id } }, { returnDocument: 'after', session }).lean()
    await Lead.updateMany({ email: user.email.toLowerCase(), status: { $ne: 'enrolled' } }, { $set: { status: 'enrolled' } }, { session })
    await audit(req, 'application.enrol', 'application', app._id, { studentId: String(student._id), studentNumber: student.student_number }, session)
    return { application, student, charges, user }
  })

  defer(() => sendMail({
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
  }))
  return { application: result.application, student: result.student, charges: result.charges.length }
}

applications.get('/:id/admission-letter.pdf', async (req, res) => {
  const app = await loadApplication(idParam(req))
  if (!['admitted', 'enrolled'].includes(app.status)) throw badRequest('Admission letters are only available for admitted applicants')
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="admission-letter-${app.reference}.pdf"`)
  res.send(await letterFor(app))
})
