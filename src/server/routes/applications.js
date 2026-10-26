// Applicant side of online admissions: save-and-resume drafts, document uploads, submit, track (spec §7).
import { z } from 'zod'
import { Application, Programme, Cohort, Student, Lead, File } from '../db/models.js'
import { config } from '../config.js'
import { parse, idParam } from '../lib/validate.js'
import { resolveUpload, sendFile, deleteFile } from '../lib/storage.js'
import { verificationCode } from '../lib/security.js'
import { sendMail, layout } from '../lib/mailer.js'
import { admissionLetterPdf } from '../lib/pdf.js'
import { requireRole, ADMIN_ROLES } from '../middleware/auth.js'
import { Router, HttpError, badRequest, notFoundError, forbidden, defer } from '../http.js'

export const applications = new Router()
applications.use(requireRole('applicant', 'student'))

export const DOCUMENT_KINDS = {
  photo: { label: 'Passport photograph', required: true, purpose: 'application_photo' },
  idDoc: { label: 'Valid ID', required: true, purpose: 'application_document' },
  certificate: { label: 'Educational certificate', required: false, purpose: 'application_document' },
  sponsorLetter: { label: 'Sponsorship letter', required: false, purpose: 'application_document' },
}

const text = (max = 200) => z.string().trim().max(max).optional().default('')
const draftSchema = z.object({
  programme: z.string().trim().max(100).optional().default(''),
  step: z.coerce.number().int().min(0).max(10).default(0),
  personal: z.object({
    fullName: text(120), dob: text(10), gender: text(20), phone: text(30), email: text(254),
    address: text(300), city: text(100), state: text(100),
  }).partial().default({}),
  guardian: z.object({ name: text(120), phone: text(30), relationship: text(60), sponsor: text(160) }).partial().default({}),
  background: z.object({ education: text(100), experience: text(100), goal: text(2000) }).partial().default({}),
})

async function newReference() {
  for (;;) {
    const ref = `CCA-${new Date().getFullYear()}-${verificationCode(6)}`
    if (!(await Application.exists({ reference: ref }))) return ref
  }
}

async function present(app) {
  if (!app) return null
  const files = await File.find({ _id: { $in: (app.documents ?? []).map((d) => d.file_id) } }).lean()
  const byId = new Map(files.map((f) => [String(f._id), f]))
  const documents = {}
  for (const d of app.documents ?? []) {
    const f = byId.get(String(d.file_id))
    if (f) documents[d.kind] = { id: String(f._id), name: f.filename, type: f.mime_type, size: f.size_bytes }
  }
  const programme = app.programme_id ? await Programme.findById(app.programme_id, 'slug name').lean() : null
  return {
    id: String(app._id),
    reference: app.reference,
    status: app.status,
    step: app.current_step,
    programme: programme?.slug ?? '',
    programmeName: programme?.name ?? null,
    personal: app.data?.personal ?? {},
    guardian: app.data?.guardian ?? {},
    background: app.data?.background ?? {},
    documents,
    submittedAt: app.submitted_at,
    decidedAt: app.decided_at,
    updatedAt: app.updated_at,
  }
}

// The applicant's working application: their open draft, else their most recent submission.
async function currentFor(userId) {
  return (await Application.findOne({ user_id: userId, status: 'draft' }).sort({ created_at: -1 }).lean())
    ?? Application.findOne({ user_id: userId }).sort({ created_at: -1 }).lean()
}

async function draftFor(userId, { create = false } = {}) {
  const draft = await Application.findOne({ user_id: userId, status: 'draft' }).sort({ created_at: -1 }).lean()
  if (draft || !create) return draft
  return (await Application.create({ user_id: userId, reference: await newReference() })).toObject()
}

applications.get('/mine', async (req, res) => {
  const rows = await Application.find({ user_id: req.user._id }).sort({ created_at: -1 }).lean()
  res.json(await Promise.all(rows.map(present)))
})

applications.get('/current', async (req, res) => {
  res.json(await present(await currentFor(req.user._id)))
})

// Starts a fresh draft (e.g. a previous application was declined, or a student applying for another programme).
applications.post('/new', async (req, res) => {
  res.status(201).json(await present(await draftFor(req.user._id, { create: true })))
})

applications.put('/current', async (req, res) => {
  const body = parse(draftSchema, req.body)
  let programmeId = null
  if (body.programme) {
    const p = await Programme.findOne({ slug: body.programme, is_published: true }, '_id').lean()
    if (!p) throw badRequest('Please choose a programme from the list', { programme: 'Unknown programme' })
    programmeId = p._id
  }
  const draft = await draftFor(req.user._id, { create: true })
  const updated = await Application.findByIdAndUpdate(
    draft._id,
    { $set: { programme_id: programmeId, current_step: body.step, data: { personal: body.personal, guardian: body.guardian, background: body.background } } },
    { returnDocument: 'after' },
  ).lean()
  res.json(await present(updated))
})

// Attaches a document: JSON { fileId } from a direct upload, or a small multipart `file`.
applications.post('/current/documents/:kind', async (req, res) => {
  const kind = DOCUMENT_KINDS[req.params.kind]
  if (!kind) throw badRequest('Unknown document type')
  const file = await resolveUpload(req, { purpose: kind.purpose })
  if (!file) throw badRequest('Please attach a file')
  const draft = await draftFor(req.user._id, { create: true })
  const old = (draft.documents ?? []).find((d) => d.kind === req.params.kind)
  await Application.updateOne({ _id: draft._id }, { $pull: { documents: { kind: req.params.kind } } })
  await Application.updateOne({ _id: draft._id }, { $push: { documents: { kind: req.params.kind, file_id: file._id } } })
  if (old && String(old.file_id) !== String(file._id)) await deleteFile(old.file_id)
  res.status(201).json({ id: file._id, name: file.filename, type: file.mime_type, size: file.size_bytes })
})

applications.delete('/current/documents/:kind', async (req, res) => {
  const draft = await draftFor(req.user._id)
  if (!draft) throw notFoundError()
  const doc = (draft.documents ?? []).find((d) => d.kind === req.params.kind)
  if (doc) {
    await Application.updateOne({ _id: draft._id }, { $pull: { documents: { kind: req.params.kind } } })
    await deleteFile(doc.file_id)
  }
  res.json({ ok: true })
})

applications.get('/documents/:fileId', async (req, res) => {
  const fileId = idParam(req, 'fileId')
  const owned = await Application.exists({ user_id: req.user._id, 'documents.file_id': fileId })
  if (!owned && !ADMIN_ROLES.includes(req.user.role)) throw forbidden()
  await sendFile(res, fileId)
})

const submitSchema = z.object({ consent: z.literal(true, { message: 'Please accept the declaration' }) })

applications.post('/current/submit', async (req, res) => {
  parse(submitSchema, req.body)
  const draft = await draftFor(req.user._id)
  if (!draft) throw badRequest('There is no draft application to submit')
  const app = await present(draft)

  const missing = {}
  if (!draft.programme_id) missing.programme = 'Choose a programme'
  for (const f of ['fullName', 'dob', 'phone']) if (!app.personal[f]) missing[f] = 'Required'
  for (const f of ['education', 'experience']) if (!app.background[f]) missing[f] = 'Required'
  for (const [k, def] of Object.entries(DOCUMENT_KINDS)) if (def.required && !app.documents[k]) missing[k] = `Upload your ${def.label.toLowerCase()}`
  if (Object.keys(missing).length) throw badRequest('Your application is incomplete', missing)

  const submitted = await Application.findOneAndUpdate(
    { _id: draft._id, status: 'draft' },
    { $set: { status: 'received', submitted_at: new Date() } },
    { returnDocument: 'after' },
  ).lean()
  if (!submitted) throw new HttpError(409, 'This application has already been submitted')
  // Link any lead with the same email so the leads pipeline shows the conversion (spec §6.2).
  await Lead.updateMany({ email: req.user.email.toLowerCase(), status: { $in: ['new', 'contacted', 'interested'] } }, { $set: { status: 'applied' } })

  defer(async () => {
    await sendMail({
      to: req.user.email,
      subject: `Application received — ${submitted.reference}`,
      html: layout({
        heading: 'We have received your application',
        paragraphs: [
          `Thank you for applying for the ${app.programmeName}. Your reference is ${submitted.reference}.`,
          'Our admissions team will review your application and update its status in your portal. We will also contact you by email or phone.',
        ],
        action: { label: 'Track your application', url: `${config.webUrl}/portal` },
      }),
    })
    if (config.adminNotifyEmails.length) {
      await sendMail({
        to: config.adminNotifyEmails,
        subject: `New application ${submitted.reference}: ${app.personal.fullName}`,
        html: layout({ heading: 'New application', paragraphs: [`${app.personal.fullName} applied for ${app.programmeName}.`], action: { label: 'Review application', url: `${config.adminUrl}/applications/${submitted._id}` } }),
      })
    }
  })
  res.json(await present(submitted))
})

// The applicant's own admission letter, once admitted.
applications.get('/:id/admission-letter.pdf', async (req, res) => {
  const app = await Application.findOne({ _id: idParam(req), user_id: req.user._id, status: { $in: ['admitted', 'enrolled'] } }).lean()
  if (!app) throw notFoundError('Admission letter not available')
  const [programme, cohort, student] = await Promise.all([
    Programme.findById(app.programme_id).lean(),
    app.cohort_id ? Cohort.findById(app.cohort_id).lean() : null,
    app.student_id ? Student.findById(app.student_id, 'student_number').lean() : null,
  ])
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="admission-letter-${app.reference}.pdf"`)
  res.send(await admissionLetterPdf({ application: app, programme, cohort, studentNumber: student?.student_number }))
})

export { present as presentApplication }
