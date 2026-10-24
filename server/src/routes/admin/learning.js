// Learning materials, assignments + marking, announcements and bulk messaging (spec §8.5, §9.5).
import { Router } from 'express'
import { z } from 'zod'
import { many, one, query, tx, db } from '../../db/pool.js'
import { config } from '../../config.js'
import { parse, idParam, id, optionalId, requiredText, optionalText } from '../../lib/validate.js'
import { upload, storeFile, sendFile, MATERIAL_TYPES } from '../../lib/files.js'
import { audit } from '../../lib/audit.js'
import { sendMail, layout, emailConfigured } from '../../lib/mailer.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { badRequest, notFoundError } from '../../middleware/errors.js'

export const learning = Router()

// ── Materials ────────────────────────────────────────────────────────────────

learning.get('/materials', async (req, res) => {
  res.json(await many(
    `SELECT m.*, p.name AS programme_name, co.name AS cohort_name, c.name AS course_name, f.filename, f.size_bytes
       FROM materials m LEFT JOIN programmes p ON p.id = m.programme_id LEFT JOIN cohorts co ON co.id = m.cohort_id
       LEFT JOIN courses c ON c.id = m.course_id LEFT JOIN files f ON f.id = m.file_id
      ORDER BY m.created_at DESC`,
  ))
})

const materialSchema = z.object({
  title: requiredText(200),
  description: optionalText(3000),
  programmeId: optionalId,
  cohortId: optionalId,
  courseId: optionalId,
  url: z.string().trim().url('Enter a full link starting with https://').max(1000).optional().nullable().or(z.literal('').transform(() => null)),
  isPublished: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).default(true),
})

learning.post('/materials', upload.single('file'), async (req, res) => {
  const b = parse(materialSchema, req.body)
  if (!req.file && !b.url) throw badRequest('Upload a file or add a link')
  const row = await tx(async (t) => {
    const f = req.file ? await storeFile(t, req.file, req.user.id, MATERIAL_TYPES) : null
    return t.one(
      `INSERT INTO materials (title, description, programme_id, cohort_id, course_id, file_id, url, is_published, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [b.title, b.description, b.programmeId, b.cohortId, b.courseId, f?.id ?? null, b.url, b.isPublished, req.user.id],
    )
  })
  await audit(req, 'material.create', 'material', row.id, { title: b.title })
  res.status(201).json(row)
})

learning.patch('/materials/:id', async (req, res) => {
  const b = parse(materialSchema.partial(), req.body)
  const row = await one(
    `UPDATE materials SET title = COALESCE($2, title), description = COALESCE($3, description), is_published = COALESCE($4, is_published)
      WHERE id = $1 RETURNING *`,
    [idParam(req), b.title ?? null, b.description ?? null, b.isPublished ?? null],
  )
  if (!row) throw notFoundError()
  res.json(row)
})

learning.delete('/materials/:id', async (req, res) => {
  const m = await one('DELETE FROM materials WHERE id = $1 RETURNING file_id, title', [idParam(req)])
  if (!m) throw notFoundError()
  if (m.file_id) await query('DELETE FROM files WHERE id = $1', [m.file_id])
  await audit(req, 'material.delete', 'material', idParam(req), { title: m.title })
  res.json({ ok: true })
})

learning.get('/materials/:id/download', async (req, res) => {
  const m = await one('SELECT file_id FROM materials WHERE id = $1', [idParam(req)])
  if (!m?.file_id) throw notFoundError()
  await sendFile(res, db, m.file_id, { inline: false })
})

// ── Assignments & submissions ────────────────────────────────────────────────

learning.get('/assignments', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: optionalId }), req.query)
  res.json(await many(
    `SELECT a.*, co.name AS cohort_name, c.name AS course_name,
            (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id)::int AS submissions,
            (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.reviewed_at IS NULL)::int AS unmarked,
            (SELECT COUNT(*) FROM students st WHERE st.cohort_id = a.cohort_id AND st.status = 'active')::int AS cohort_size
       FROM assignments a JOIN cohorts co ON co.id = a.cohort_id LEFT JOIN courses c ON c.id = a.course_id
      ${cohortId ? 'WHERE a.cohort_id = $1' : ''} ORDER BY a.created_at DESC`,
    cohortId ? [cohortId] : [],
  ))
})

const assignmentSchema = z.object({
  cohortId: id,
  courseId: optionalId,
  title: requiredText(200),
  description: optionalText(10000),
  dueAt: z.string().datetime({ offset: true, local: true }).optional().nullable().or(z.literal('').transform(() => null)),
})

learning.post('/assignments', async (req, res) => {
  const b = parse(assignmentSchema, req.body)
  const row = await one(
    'INSERT INTO assignments (cohort_id, course_id, title, description, due_at, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [b.cohortId, b.courseId, b.title, b.description, b.dueAt ?? null, req.user.id],
  )
  await audit(req, 'assignment.create', 'assignment', row.id, { title: b.title })
  res.status(201).json(row)
})

learning.put('/assignments/:id', async (req, res) => {
  const b = parse(assignmentSchema, req.body)
  const row = await one(
    'UPDATE assignments SET cohort_id = $2, course_id = $3, title = $4, description = $5, due_at = $6 WHERE id = $1 RETURNING *',
    [idParam(req), b.cohortId, b.courseId, b.title, b.description, b.dueAt ?? null],
  )
  if (!row) throw notFoundError()
  res.json(row)
})

learning.delete('/assignments/:id', async (req, res) => {
  await query('DELETE FROM assignments WHERE id = $1', [idParam(req)])
  await audit(req, 'assignment.delete', 'assignment', idParam(req))
  res.json({ ok: true })
})

learning.get('/assignments/:id/submissions', async (req, res) => {
  const a = await one('SELECT a.*, co.name AS cohort_name FROM assignments a JOIN cohorts co ON co.id = a.cohort_id WHERE a.id = $1', [idParam(req)])
  if (!a) throw notFoundError()
  const rows = await many(
    `SELECT st.id AS student_id, st.student_number, st.first_name, st.last_name,
            s.id, s.note, s.submitted_at, s.feedback, s.score, s.reviewed_at, f.filename
       FROM students st
       LEFT JOIN submissions s ON s.student_id = st.id AND s.assignment_id = $1
       LEFT JOIN files f ON f.id = s.file_id
      WHERE st.cohort_id = $2 AND st.status <> 'archived' OR s.id IS NOT NULL
      ORDER BY s.submitted_at IS NULL, st.last_name`,
    [a.id, a.cohort_id],
  )
  res.json({ assignment: a, rows })
})

learning.get('/submissions/:id/file', async (req, res) => {
  const s = await one('SELECT file_id FROM submissions WHERE id = $1', [idParam(req)])
  if (!s?.file_id) throw notFoundError()
  await sendFile(res, db, s.file_id, { inline: false })
})

learning.patch('/submissions/:id', async (req, res) => {
  const b = parse(z.object({ feedback: optionalText(5000), score: z.coerce.number().min(0).max(100).optional().nullable() }), req.body)
  const row = await one(
    `UPDATE submissions SET feedback = $2, score = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1 RETURNING *`,
    [idParam(req), b.feedback, b.score ?? null, req.user.id],
  )
  if (!row) throw notFoundError()
  res.json(row)
})

// ── Announcements (pushed to the student portal, optional email copy) ───────

learning.get('/announcements', async (req, res) => {
  res.json(await many(
    `SELECT a.*, p.name AS programme_name, c.name AS cohort_name, u.full_name AS author
       FROM announcements a LEFT JOIN programmes p ON p.id = a.programme_id LEFT JOIN cohorts c ON c.id = a.cohort_id
       LEFT JOIN users u ON u.id = a.created_by ORDER BY a.created_at DESC LIMIT 200`,
  ))
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

async function audienceEmails(a) {
  const params = []
  let where = `s.status = 'active'`
  if (a.audience === 'programme') where += ` AND s.programme_id = $${params.push(a.programmeId)}`
  if (a.audience === 'cohort') where += ` AND s.cohort_id = $${params.push(a.cohortId)}`
  const rows = await many(`SELECT DISTINCT COALESCE(u.email, s.email) AS email FROM students s LEFT JOIN users u ON u.id = s.user_id WHERE ${where}`, params)
  return rows.map((r) => r.email).filter(Boolean)
}

learning.post('/announcements', async (req, res) => {
  const b = parse(announcementSchema, req.body)
  const row = await one(
    `INSERT INTO announcements (title, body, audience, programme_id, cohort_id, is_pinned, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [b.title, b.body, b.audience, b.audience === 'programme' ? b.programmeId : null, b.audience === 'cohort' ? b.cohortId : null, b.isPinned, b.expiresAt ?? null, req.user.id],
  )
  let emailed = 0
  if (b.emailCopy) {
    const emails = await audienceEmails(b)
    for (const to of emails) {
      sendMail({ to, sentBy: req.user.id, subject: b.title, html: layout({ heading: b.title, paragraphs: b.body.split(/\n{2,}/), action: { label: 'Open student portal', url: `${config.webUrl}/portal` } }) })
    }
    emailed = emails.length
  }
  await audit(req, 'announcement.create', 'announcement', row.id, { title: b.title, audience: b.audience, emailed })
  res.status(201).json({ ...row, emailed })
})

learning.delete('/announcements/:id', async (req, res) => {
  await query('DELETE FROM announcements WHERE id = $1', [idParam(req)])
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
      return (await many(`SELECT DISTINCT email FROM leads WHERE email IS NOT NULL AND consent ${b.leadStatus ? 'AND status = $1' : ''}`, b.leadStatus ? [b.leadStatus] : [])).map((r) => r.email)
    case 'selected_leads':
      return (await many('SELECT DISTINCT email FROM leads WHERE email IS NOT NULL AND id = ANY($1)', [b.leadIds ?? []])).map((r) => r.email)
    case 'students':
      return audienceEmails({ audience: 'all' })
    case 'cohort':
      if (!b.cohortId) throw badRequest('Choose a cohort', { cohortId: 'Required' })
      return audienceEmails({ audience: 'cohort', cohortId: b.cohortId })
    case 'alumni':
      return (await many(`SELECT DISTINCT COALESCE(u.email, s.email) AS email FROM students s LEFT JOIN users u ON u.id = s.user_id WHERE s.status = 'graduated'`)).map((r) => r.email).filter(Boolean)
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
  // Sent sequentially in the background so large lists don't hold the request open.
  ;(async () => {
    for (const to of recipients) {
      await sendMail({ to, sentBy: req.user.id, subject: b.subject, html: layout({ heading: b.subject, paragraphs: b.body.split(/\n{2,}/) }) })
    }
  })().catch((e) => console.error('bulk send failed', e))
  res.json({ queued: recipients.length })
})
