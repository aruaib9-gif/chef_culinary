// Learning materials, assignments + marking, announcements and bulk messaging (spec §8.5, §9.5).
import { z } from 'zod'
import { Material, Programme, Cohort, Course, File, Assignment, Submission, Student, Announcement, User, Lead } from '../../db/models.js'
import { config } from '../../config.js'
import { parse, idParam, id, optionalId, requiredText, optionalText } from '../../lib/validate.js'
import { resolveUpload, sendFile, deleteFile } from '../../lib/storage.js'
import { audit } from '../../lib/audit.js'
import { sendMail, layout, emailConfigured } from '../../lib/mailer.js'
import { byIds, pick } from '../../lib/lookup.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { Router, badRequest, notFoundError, defer } from '../../http.js'

export const learning = new Router()

// ── Materials ────────────────────────────────────────────────────────────────

learning.get('/materials', async (req, res) => {
  const rows = await Material.find().sort({ created_at: -1 }).lean()
  const [programmes, cohorts, courses, files] = await Promise.all([
    byIds(Programme, rows.map((m) => m.programme_id), 'name'),
    byIds(Cohort, rows.map((m) => m.cohort_id), 'name'),
    byIds(Course, rows.map((m) => m.course_id), 'name'),
    byIds(File, rows.map((m) => m.file_id), 'filename size_bytes'),
  ])
  res.json(rows.map((m) => ({
    ...m, programme_name: pick(programmes, m.programme_id, 'name'), cohort_name: pick(cohorts, m.cohort_id, 'name'),
    course_name: pick(courses, m.course_id, 'name'), filename: pick(files, m.file_id, 'filename'), size_bytes: pick(files, m.file_id, 'size_bytes'),
  })))
})

const boolish = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
const materialSchema = z.object({
  title: requiredText(200),
  description: optionalText(3000),
  programmeId: optionalId,
  cohortId: optionalId,
  courseId: optionalId,
  url: z.string().trim().url('Enter a full link starting with https://').max(1000).optional().nullable().or(z.literal('').transform(() => null)),
  isPublished: boolish.default(true),
  fileId: optionalId,
})

// Body: JSON with optional { fileId } from a direct upload, or multipart fields + a small `file`.
learning.post('/materials', async (req, res) => {
  const b = parse(materialSchema, req.body)
  const f = await resolveUpload(req, { purpose: 'material' })
  if (!f && !b.url) throw badRequest('Upload a file or add a link')
  const row = await Material.create({
    title: b.title, description: b.description, programme_id: b.programmeId, cohort_id: b.cohortId, course_id: b.courseId,
    file_id: f?._id ?? null, url: b.url, is_published: b.isPublished, created_by: req.user.id,
  })
  await audit(req, 'material.create', 'material', row._id, { title: b.title })
  res.status(201).json(row)
})

learning.patch('/materials/:id', async (req, res) => {
  const b = parse(materialSchema.partial(), req.body)
  const set = {}
  if (b.title) set.title = b.title
  if (b.description != null) set.description = b.description
  if (b.isPublished != null) set.is_published = b.isPublished
  const row = await Material.findByIdAndUpdate(idParam(req), { $set: set }, { returnDocument: 'after' }).lean()
  if (!row) throw notFoundError()
  res.json(row)
})

learning.delete('/materials/:id', async (req, res) => {
  const m = await Material.findByIdAndDelete(idParam(req)).lean()
  if (!m) throw notFoundError()
  if (m.file_id) await deleteFile(m.file_id)
  await audit(req, 'material.delete', 'material', m._id, { title: m.title })
  res.json({ ok: true })
})

learning.get('/materials/:id/download', async (req, res) => {
  const m = await Material.findById(idParam(req), 'file_id').lean()
  if (!m?.file_id) throw notFoundError()
  await sendFile(res, m.file_id, { inline: false })
})

// ── Assignments & submissions ────────────────────────────────────────────────

learning.get('/assignments', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: optionalId }), req.query)
  const rows = await Assignment.find(cohortId ? { cohort_id: cohortId } : {}).sort({ created_at: -1 }).lean()
  const ids = rows.map((a) => a._id)
  const [cohorts, courses, subs, sizes] = await Promise.all([
    byIds(Cohort, rows.map((a) => a.cohort_id), 'name'),
    byIds(Course, rows.map((a) => a.course_id), 'name'),
    Submission.aggregate([
      { $match: { assignment_id: { $in: ids } } },
      { $group: { _id: '$assignment_id', n: { $sum: 1 }, unmarked: { $sum: { $cond: [{ $eq: ['$reviewed_at', null] }, 1, 0] } } } },
    ]),
    Student.aggregate([{ $match: { status: 'active', cohort_id: { $in: rows.map((a) => a.cohort_id) } } }, { $group: { _id: '$cohort_id', n: { $sum: 1 } } }]),
  ])
  const subBy = new Map(subs.map((s) => [String(s._id), s]))
  const sizeBy = new Map(sizes.map((s) => [String(s._id), s.n]))
  res.json(rows.map((a) => ({
    ...a, cohort_name: pick(cohorts, a.cohort_id, 'name'), course_name: pick(courses, a.course_id, 'name'),
    submissions: subBy.get(String(a._id))?.n ?? 0, unmarked: subBy.get(String(a._id))?.unmarked ?? 0, cohort_size: sizeBy.get(String(a.cohort_id)) ?? 0,
  })))
})

const assignmentSchema = z.object({
  cohortId: id,
  courseId: optionalId,
  title: requiredText(200),
  description: optionalText(10000),
  dueAt: z.string().datetime({ offset: true, local: true }).optional().nullable().or(z.literal('').transform(() => null)),
})

const assignmentDoc = (b) => ({ cohort_id: b.cohortId, course_id: b.courseId, title: b.title, description: b.description, due_at: b.dueAt ? new Date(b.dueAt) : null })

learning.post('/assignments', async (req, res) => {
  const b = parse(assignmentSchema, req.body)
  const row = await Assignment.create({ ...assignmentDoc(b), created_by: req.user.id })
  await audit(req, 'assignment.create', 'assignment', row._id, { title: b.title })
  res.status(201).json(row)
})

learning.put('/assignments/:id', async (req, res) => {
  const b = parse(assignmentSchema, req.body)
  const row = await Assignment.findByIdAndUpdate(idParam(req), { $set: assignmentDoc(b) }, { returnDocument: 'after' }).lean()
  if (!row) throw notFoundError()
  res.json(row)
})

learning.delete('/assignments/:id', async (req, res) => {
  const aid = idParam(req)
  const subs = await Submission.find({ assignment_id: aid }, 'file_id').lean()
  await Submission.deleteMany({ assignment_id: aid })
  await Assignment.deleteOne({ _id: aid })
  for (const s of subs) if (s.file_id) await deleteFile(s.file_id)
  await audit(req, 'assignment.delete', 'assignment', aid)
  res.json({ ok: true })
})

learning.get('/assignments/:id/submissions', async (req, res) => {
  const a = await Assignment.findById(idParam(req)).lean()
  if (!a) throw notFoundError()
  a.cohort_name = (await Cohort.findById(a.cohort_id, 'name').lean())?.name ?? null
  const subs = await Submission.find({ assignment_id: a._id }).lean()
  const students = await Student.find({
    $or: [{ cohort_id: a.cohort_id, status: { $ne: 'archived' } }, { _id: { $in: subs.map((s) => s.student_id) } }],
  }, 'student_number first_name last_name').lean()
  const files = await byIds(File, subs.map((s) => s.file_id), 'filename')
  const subBy = new Map(subs.map((s) => [String(s.student_id), s]))
  const rows = students.map((st) => {
    const s = subBy.get(String(st._id))
    return {
      student_id: String(st._id), student_number: st.student_number, first_name: st.first_name, last_name: st.last_name,
      id: s ? String(s._id) : null, note: s?.note ?? null, submitted_at: s?.submitted_at ?? null, feedback: s?.feedback ?? null,
      score: s?.score ?? null, reviewed_at: s?.reviewed_at ?? null, filename: pick(files, s?.file_id, 'filename'),
    }
  })
  rows.sort((x, y) => Number(!x.submitted_at) - Number(!y.submitted_at) || x.last_name.localeCompare(y.last_name))
  res.json({ assignment: a, rows })
})

learning.get('/submissions/:id/file', async (req, res) => {
  const s = await Submission.findById(idParam(req), 'file_id').lean()
  if (!s?.file_id) throw notFoundError()
  await sendFile(res, s.file_id, { inline: false })
})

learning.patch('/submissions/:id', async (req, res) => {
  const b = parse(z.object({ feedback: optionalText(5000), score: z.coerce.number().min(0).max(100).optional().nullable() }), req.body)
  const row = await Submission.findByIdAndUpdate(
    idParam(req),
    { $set: { feedback: b.feedback, score: b.score ?? null, reviewed_by: req.user.id, reviewed_at: new Date() } },
    { returnDocument: 'after' },
  ).lean()
  if (!row) throw notFoundError()
  res.json(row)
})

// ── Announcements (pushed to the student portal, optional email copy) ───────

learning.get('/announcements', async (req, res) => {
  const rows = await Announcement.find().sort({ created_at: -1 }).limit(200).lean()
  const [programmes, cohorts, users] = await Promise.all([
    byIds(Programme, rows.map((a) => a.programme_id), 'name'),
    byIds(Cohort, rows.map((a) => a.cohort_id), 'name'),
    byIds(User, rows.map((a) => a.created_by), 'full_name'),
  ])
  res.json(rows.map((a) => ({ ...a, programme_name: pick(programmes, a.programme_id, 'name'), cohort_name: pick(cohorts, a.cohort_id, 'name'), author: pick(users, a.created_by, 'full_name') })))
})

const announcementSchema = z.object({
  title: requiredText(200),
  body: requiredText(10000),
  audience: z.enum(['all', 'programme', 'cohort']).default('all'),
  programmeId: optionalId,
  cohortId: optionalId,
  isPinned: z.boolean().default(false),
  expiresAt: z.string().optional().nullable().or(z.literal('').transform(() => null)),
  emailCopy: z.boolean().default(false),
}).refine((a) => a.audience !== 'programme' || a.programmeId, { message: 'Choose a programme', path: ['programmeId'] })
  .refine((a) => a.audience !== 'cohort' || a.cohortId, { message: 'Choose a cohort', path: ['cohortId'] })

// Emails of active students in an audience (login email first, else the record's email).
async function audienceEmails(a) {
  const q = { status: 'active' }
  if (a.audience === 'programme') q.programme_id = a.programmeId
  if (a.audience === 'cohort') q.cohort_id = a.cohortId
  return studentEmails(await Student.find(q, 'email user_id').lean())
}

async function studentEmails(students) {
  const users = await byIds(User, students.map((s) => s.user_id), 'email')
  return [...new Set(students.map((s) => pick(users, s.user_id, 'email') ?? s.email).filter(Boolean))]
}

learning.post('/announcements', async (req, res) => {
  const b = parse(announcementSchema, req.body)
  const row = await Announcement.create({
    title: b.title, body: b.body, audience: b.audience, programme_id: b.audience === 'programme' ? b.programmeId : null,
    cohort_id: b.audience === 'cohort' ? b.cohortId : null, is_pinned: b.isPinned, expires_at: b.expiresAt ? new Date(b.expiresAt) : null, created_by: req.user.id,
  })
  let emailed = 0
  if (b.emailCopy) {
    const emails = await audienceEmails(b)
    emailed = emails.length
    defer(async () => {
      for (const to of emails) {
        await sendMail({ to, sentBy: req.user.id, subject: b.title, html: layout({ heading: b.title, paragraphs: b.body.split(/\n{2,}/), action: { label: 'Open student portal', url: `${config.webUrl}/portal` } }) })
      }
    })
  }
  await audit(req, 'announcement.create', 'announcement', row._id, { title: b.title, audience: b.audience, emailed })
  res.status(201).json({ ...row.toObject(), emailed })
})

learning.delete('/announcements/:id', async (req, res) => {
  await Announcement.deleteOne({ _id: idParam(req) })
  await audit(req, 'announcement.delete', 'announcement', idParam(req))
  res.json({ ok: true })
})

// ── Bulk messaging to leads / students / alumni (spec §6.2, §9.5) ────────────

const messageSchema = z.object({
  audience: z.enum(['leads', 'students', 'alumni', 'cohort', 'selected_leads']),
  leadStatus: z.string().max(40).optional().nullable(),
  cohortId: optionalId,
  leadIds: z.array(id).max(5000).optional(),
  subject: requiredText(200),
  body: requiredText(20000),
})

async function recipientsFor(b) {
  switch (b.audience) {
    case 'leads':
      return Lead.distinct('email', { email: { $ne: null }, consent: true, ...(b.leadStatus ? { status: b.leadStatus } : {}) })
    case 'selected_leads':
      return Lead.distinct('email', { email: { $ne: null }, _id: { $in: b.leadIds ?? [] } })
    case 'students':
      return audienceEmails({ audience: 'all' })
    case 'cohort':
      if (!b.cohortId) throw badRequest('Choose a cohort', { cohortId: 'Required' })
      return audienceEmails({ audience: 'cohort', cohortId: b.cohortId })
    case 'alumni':
      return studentEmails(await Student.find({ status: 'graduated' }, 'email user_id').lean())
  }
  return []
}

learning.post('/messaging/preview', async (req, res) => {
  const b = parse(messageSchema, req.body)
  const recipients = await recipientsFor(b)
  res.json({ count: recipients.length, sample: recipients.slice(0, 5), emailConfigured: emailConfigured() })
})

learning.post('/messaging/send', requireSuperAdmin, async (req, res) => {
  const b = parse(messageSchema, req.body)
  const recipients = await recipientsFor(b)
  if (!recipients.length) throw badRequest('No recipients match this audience')
  await audit(req, 'messaging.send', 'message', null, { audience: b.audience, subject: b.subject, count: recipients.length })
  // Sent one by one after the response so large lists don't hold the request open.
  defer(async () => {
    for (const to of recipients) {
      await sendMail({ to, sentBy: req.user.id, subject: b.subject, html: layout({ heading: b.subject, paragraphs: b.body.split(/\n{2,}/) }) })
    }
  })
  res.json({ queued: recipients.length })
})
