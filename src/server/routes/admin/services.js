// Student requests (transcripts, letters, change of details) and course feedback (spec §8.5).
import { z } from 'zod'
import { StudentRequest, Student, User, Feedback, Course, Cohort } from '../../db/models.js'
import { parse, idParam, optionalText, optionalId } from '../../lib/validate.js'
import { sendMail, layout } from '../../lib/mailer.js'
import { audit } from '../../lib/audit.js'
import { byIds, pick } from '../../lib/lookup.js'
import { config } from '../../config.js'
import { Router, notFoundError, defer } from '../../http.js'

export const services = new Router()

services.get('/requests', async (req, res) => {
  const { status } = parse(z.object({ status: z.string().max(20).optional() }), req.query)
  const rows = await StudentRequest.find(status ? { status } : {}).sort({ created_at: -1 }).limit(500).lean()
  rows.sort((a, b) => Number(['open', 'in_progress'].includes(b.status)) - Number(['open', 'in_progress'].includes(a.status)))
  const [students, users] = await Promise.all([
    byIds(Student, rows.map((r) => r.student_id), 'student_number first_name last_name'),
    byIds(User, rows.map((r) => r.handled_by), 'full_name'),
  ])
  res.json(rows.map((r) => ({
    ...r,
    student_number: pick(students, r.student_id, 'student_number'), first_name: pick(students, r.student_id, 'first_name'),
    last_name: pick(students, r.student_id, 'last_name'), handled_by_name: pick(users, r.handled_by, 'full_name'),
  })))
})

services.patch('/requests/:id', async (req, res) => {
  const b = parse(z.object({ status: z.enum(['open', 'in_progress', 'completed', 'rejected']), response: optionalText(5000), notify: z.boolean().default(true) }), req.body)
  const set = { status: b.status, handled_by: req.user.id }
  if (b.response != null) set.response = b.response
  const row = await StudentRequest.findByIdAndUpdate(idParam(req), { $set: set }, { returnDocument: 'after' }).lean()
  if (!row) throw notFoundError()
  await audit(req, 'request.update', 'student_request', row._id, { status: b.status })
  if (b.notify && ['completed', 'rejected'].includes(b.status)) {
    const s = await Student.findById(row.student_id, 'first_name email user_id').lean()
    const email = (s?.user_id && (await User.findById(s.user_id, 'email').lean())?.email) || s?.email
    if (email) {
      defer(() => sendMail({
        to: email,
        sentBy: req.user.id,
        subject: `Your request has been ${b.status}`,
        html: layout({ heading: 'Request update', paragraphs: [`Hello ${s.first_name}, your ${row.type.replace(/_/g, ' ')} request has been ${b.status}.`, row.response ?? ''].filter(Boolean), action: { label: 'View in portal', url: `${config.webUrl}/portal/requests` } }),
      }))
    }
  }
  res.json(row)
})

services.get('/feedback', async (req, res) => {
  const { cohortId, courseId } = parse(z.object({ cohortId: optionalId, courseId: optionalId }), req.query)
  const q = {}
  if (cohortId) q.cohort_id = cohortId
  if (courseId) q.course_id = courseId
  const rows = await Feedback.find(q).sort({ created_at: -1 }).limit(500).lean()
  const [courses, cohorts, students] = await Promise.all([
    byIds(Course, rows.map((r) => r.course_id), 'name'),
    byIds(Cohort, rows.map((r) => r.cohort_id), 'name'),
    byIds(Student, rows.map((r) => r.student_id), 'student_number'),
  ])
  const summaryMap = new Map()
  for (const r of rows) {
    const name = pick(courses, r.course_id, 'name') ?? 'General'
    const e = summaryMap.get(name) ?? { course_name: name, responses: 0, total: 0 }
    e.responses++
    e.total += r.rating
    summaryMap.set(name, e)
  }
  res.json({
    rows: rows.map((r) => ({ ...r, course_name: pick(courses, r.course_id, 'name'), cohort_name: pick(cohorts, r.cohort_id, 'name'), student_number: pick(students, r.student_id, 'student_number') })),
    summary: [...summaryMap.values()].sort((a, b) => a.course_name.localeCompare(b.course_name)).map((e) => ({ course_name: e.course_name, responses: e.responses, average: Math.round((e.total / e.responses) * 100) / 100 })),
  })
})
