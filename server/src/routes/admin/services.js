// Student requests (transcripts, letters, change of details) and course feedback (spec §8.5).
import { Router } from 'express'
import { z } from 'zod'
import { many, one } from '../../db/pool.js'
import { parse, idParam, optionalText, optionalId } from '../../lib/validate.js'
import { sendMail, layout } from '../../lib/mailer.js'
import { audit } from '../../lib/audit.js'
import { config } from '../../config.js'
import { notFoundError } from '../../middleware/errors.js'

export const services = Router()

services.get('/requests', async (req, res) => {
  const { status } = parse(z.object({ status: z.string().max(20).optional() }), req.query)
  res.json(await many(
    `SELECT r.*, s.student_number, s.first_name, s.last_name, u.full_name AS handled_by_name
       FROM student_requests r JOIN students s ON s.id = r.student_id LEFT JOIN users u ON u.id = r.handled_by
      ${status ? 'WHERE r.status = $1' : ''} ORDER BY (r.status IN ('open','in_progress')) DESC, r.created_at DESC LIMIT 500`,
    status ? [status] : [],
  ))
})

services.patch('/requests/:id', async (req, res) => {
  const b = parse(z.object({ status: z.enum(['open', 'in_progress', 'completed', 'rejected']), response: optionalText(5000), notify: z.boolean().default(true) }), req.body)
  const row = await one(
    `UPDATE student_requests SET status = $2, response = COALESCE($3, response), handled_by = $4, updated_at = now() WHERE id = $1 RETURNING *`,
    [idParam(req), b.status, b.response, req.user.id],
  )
  if (!row) throw notFoundError()
  await audit(req, 'request.update', 'student_request', row.id, { status: b.status })
  if (b.notify && ['completed', 'rejected'].includes(b.status)) {
    const s = await one('SELECT s.first_name, COALESCE(u.email, s.email) AS email FROM students s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = $1', [row.student_id])
    if (s?.email) {
      sendMail({
        to: s.email,
        sentBy: req.user.id,
        subject: `Your request has been ${b.status}`,
        html: layout({ heading: 'Request update', paragraphs: [`Hello ${s.first_name}, your ${row.type.replace(/_/g, ' ')} request has been ${b.status}.`, row.response ?? ''].filter(Boolean), action: { label: 'View in portal', url: `${config.webUrl}/portal/requests` } }),
      })
    }
  }
  res.json(row)
})

services.get('/feedback', async (req, res) => {
  const { cohortId, courseId } = parse(z.object({ cohortId: optionalId, courseId: optionalId }), req.query)
  const params = []
  const where = []
  if (cohortId) where.push(`f.cohort_id = $${params.push(cohortId)}`)
  if (courseId) where.push(`f.course_id = $${params.push(courseId)}`)
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [rows, summary] = await Promise.all([
    many(
      `SELECT f.*, c.name AS course_name, co.name AS cohort_name, s.student_number
         FROM feedback f LEFT JOIN courses c ON c.id = f.course_id LEFT JOIN cohorts co ON co.id = f.cohort_id
         JOIN students s ON s.id = f.student_id ${w} ORDER BY f.created_at DESC LIMIT 500`,
      params,
    ),
    many(
      `SELECT COALESCE(c.name, 'General') AS course_name, COUNT(*)::int AS responses, ROUND(AVG(f.rating), 2)::float AS average
         FROM feedback f LEFT JOIN courses c ON c.id = f.course_id ${w} GROUP BY 1 ORDER BY 1`,
      params,
    ),
  ])
  res.json({ rows, summary })
})
