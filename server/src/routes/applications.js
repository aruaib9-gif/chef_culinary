// Applicant side of online admissions: save-and-resume drafts, document uploads, submit, track (spec §7).
import { Router } from 'express'
import { z } from 'zod'
import { one, many, query, tx } from '../db/pool.js'
import { config } from '../config.js'
import { parse } from '../lib/validate.js'
import { upload, storeFile, sendFile, DOC_TYPES, IMAGE_TYPES } from '../lib/files.js'
import { verificationCode } from '../lib/security.js'
import { sendMail, layout } from '../lib/mailer.js'
import { admissionLetterPdf } from '../lib/pdf.js'
import { requireRole, ADMIN_ROLES } from '../middleware/auth.js'
import { HttpError, badRequest, notFoundError, forbidden } from '../middleware/errors.js'

export const applications = Router()
applications.use(requireRole('applicant', 'student'))

export const DOCUMENT_KINDS = {
  photo: { label: 'Passport photograph', required: true, types: IMAGE_TYPES },
  idDoc: { label: 'Valid ID', required: true, types: DOC_TYPES },
  certificate: { label: 'Educational certificate', required: false, types: DOC_TYPES },
  sponsorLetter: { label: 'Sponsorship letter', required: false, types: DOC_TYPES },
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
    if (!(await one('SELECT 1 FROM applications WHERE reference = $1', [ref]))) return ref
  }
}

async function present(app) {
  if (!app) return null
  const docs = await many(
    `SELECT d.kind, f.id AS file_id, f.filename, f.mime_type, f.size_bytes
       FROM application_documents d JOIN files f ON f.id = d.file_id WHERE d.application_id = $1`,
    [app.id],
  )
  const programme = app.programme_id ? await one('SELECT slug, name FROM programmes WHERE id = $1', [app.programme_id]) : null
  return {
    id: app.id,
    reference: app.reference,
    status: app.status,
    step: app.current_step,
    programme: programme?.slug ?? '',
    programmeName: programme?.name ?? null,
    personal: app.data.personal ?? {},
    guardian: app.data.guardian ?? {},
    background: app.data.background ?? {},
    documents: Object.fromEntries(docs.map((d) => [d.kind, { id: d.file_id, name: d.filename, type: d.mime_type, size: d.size_bytes }])),
    submittedAt: app.submitted_at,
    decidedAt: app.decided_at,
    updatedAt: app.updated_at,
  }
}

// The applicant's working application: their open draft, else their most recent submission.
const currentFor = (userId) =>
  one(
    `SELECT * FROM applications WHERE user_id = $1
      ORDER BY (status = 'draft') DESC, created_at DESC LIMIT 1`,
    [userId],
  )

async function draftFor(userId, { create = false } = {}) {
  const draft = await one(`SELECT * FROM applications WHERE user_id = $1 AND status = 'draft' ORDER BY created_at DESC LIMIT 1`, [userId])
  if (draft || !create) return draft
  return one(`INSERT INTO applications (user_id, reference) VALUES ($1, $2) RETURNING *`, [userId, await newReference()])
}

applications.get('/mine', async (req, res) => {
  const rows = await many('SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id])
  res.json(await Promise.all(rows.map(present)))
})

applications.get('/current', async (req, res) => {
  res.json(await present(await currentFor(req.user.id)))
})

// Starts a fresh draft (e.g. a previous application was declined, or a student applying for another programme).
applications.post('/new', async (req, res) => {
  res.status(201).json(await present(await draftFor(req.user.id, { create: true })))
})

applications.put('/current', async (req, res) => {
  const body = parse(draftSchema, req.body)
  let programmeId = null
  if (body.programme) {
    const p = await one('SELECT id FROM programmes WHERE slug = $1 AND is_published', [body.programme])
    if (!p) throw badRequest('Please choose a programme from the list', { programme: 'Unknown programme' })
    programmeId = p.id
  }
  const draft = await draftFor(req.user.id, { create: true })
  const updated = await one(
    `UPDATE applications SET programme_id = $2, current_step = $3, data = $4, updated_at = now() WHERE id = $1 RETURNING *`,
    [draft.id, programmeId, body.step, { personal: body.personal, guardian: body.guardian, background: body.background }],
  )
  res.json(await present(updated))
})

applications.post('/current/documents/:kind', upload.single('file'), async (req, res) => {
  const kind = DOCUMENT_KINDS[req.params.kind]
  if (!kind) throw badRequest('Unknown document type')
  const draft = await draftFor(req.user.id, { create: true })
  const file = await tx(async (db) => {
    const old = await db.one('SELECT file_id FROM application_documents WHERE application_id = $1 AND kind = $2', [draft.id, req.params.kind])
    const stored = await storeFile(db, req.file, req.user.id, kind.types)
    await db.query(
      `INSERT INTO application_documents (application_id, kind, file_id) VALUES ($1, $2, $3)
       ON CONFLICT (application_id, kind) DO UPDATE SET file_id = EXCLUDED.file_id, created_at = now()`,
      [draft.id, req.params.kind, stored.id],
    )
    if (old) await db.query('DELETE FROM files WHERE id = $1', [old.file_id])
    return stored
  })
  res.status(201).json({ id: file.id, name: file.filename, type: file.mime_type, size: file.size_bytes })
})

applications.delete('/current/documents/:kind', async (req, res) => {
  const draft = await draftFor(req.user.id)
  if (!draft) throw notFoundError()
  const doc = await one('DELETE FROM application_documents WHERE application_id = $1 AND kind = $2 RETURNING file_id', [draft.id, req.params.kind])
  if (doc) await query('DELETE FROM files WHERE id = $1', [doc.file_id])
  res.json({ ok: true })
})

applications.get('/documents/:fileId', async (req, res) => {
  const owned = await one(
    `SELECT 1 FROM application_documents d JOIN applications a ON a.id = d.application_id WHERE d.file_id = $1 AND a.user_id = $2`,
    [req.params.fileId, req.user.id],
  )
  if (!owned && !ADMIN_ROLES.includes(req.user.role)) throw forbidden()
  await sendFile(res, { one }, req.params.fileId)
})

const submitSchema = z.object({ consent: z.literal(true, { message: 'Please accept the declaration' }) })

applications.post('/current/submit', async (req, res) => {
  parse(submitSchema, req.body)
  const draft = await draftFor(req.user.id)
  if (!draft) throw badRequest('There is no draft application to submit')
  const app = await present(draft)

  const missing = {}
  if (!draft.programme_id) missing.programme = 'Choose a programme'
  for (const f of ['fullName', 'dob', 'phone']) if (!app.personal[f]) missing[f] = 'Required'
  for (const f of ['education', 'experience']) if (!app.background[f]) missing[f] = 'Required'
  for (const [k, def] of Object.entries(DOCUMENT_KINDS)) if (def.required && !app.documents[k]) missing[k] = `Upload your ${def.label.toLowerCase()}`
  if (Object.keys(missing).length) throw badRequest('Your application is incomplete', missing)

  const submitted = await one(
    `UPDATE applications SET status = 'received', submitted_at = now(), updated_at = now() WHERE id = $1 AND status = 'draft' RETURNING *`,
    [draft.id],
  )
  if (!submitted) throw new HttpError(409, 'This application has already been submitted')
  // Link any lead with the same email so the leads pipeline shows the conversion (spec §6.2).
  await query(`UPDATE leads SET status = 'applied', updated_at = now() WHERE lower(email) = lower($1) AND status IN ('new', 'contacted', 'interested')`, [req.user.email])

  sendMail({
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
    sendMail({
      to: config.adminNotifyEmails,
      subject: `New application ${submitted.reference}: ${app.personal.fullName}`,
      html: layout({ heading: 'New application', paragraphs: [`${app.personal.fullName} applied for ${app.programmeName}.`], action: { label: 'Review application', url: `${config.adminUrl}/applications/${submitted.id}` } }),
    })
  }
  res.json(await present(submitted))
})

// The applicant's own admission letter, once admitted.
applications.get('/:id/admission-letter.pdf', async (req, res) => {
  const app = await one(`SELECT * FROM applications WHERE id = $1 AND user_id = $2 AND status IN ('admitted', 'enrolled')`, [req.params.id, req.user.id])
  if (!app) throw notFoundError('Admission letter not available')
  const programme = await one('SELECT * FROM programmes WHERE id = $1', [app.programme_id])
  const cohort = app.cohort_id ? await one('SELECT * FROM cohorts WHERE id = $1', [app.cohort_id]) : null
  const student = app.student_id ? await one('SELECT student_number FROM students WHERE id = $1', [app.student_id]) : null
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="admission-letter-${app.reference}.pdf"`)
  res.send(await admissionLetterPdf({ application: app, programme, cohort, studentNumber: student?.student_number }))
})

export { present as presentApplication }
