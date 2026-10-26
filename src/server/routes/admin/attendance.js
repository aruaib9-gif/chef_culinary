// Daily attendance sheets, reports and low-attendance alerts (spec §9.3).
import { z } from 'zod'
import { Attendance, Cohort, Programme, Student, User } from '../../db/models.js'
import { withTransaction, oid } from '../../db/mongo.js'
import { parse, id, dateStr } from '../../lib/validate.js'
import { sendCsv } from '../../lib/csv.js'
import { audit } from '../../lib/audit.js'
import { getSettings } from '../../lib/settings.js'
import { sendMail, layout } from '../../lib/mailer.js'
import { byIds, pick } from '../../lib/lookup.js'
import { Router, badRequest, notFoundError, defer } from '../../http.js'

export const attendance = new Router()

const STATUS = z.enum(['present', 'absent', 'late', 'excused'])

attendance.get('/sheet', async (req, res) => {
  const { cohortId, date } = parse(z.object({ cohortId: id, date: dateStr }), req.query)
  const cohort = await Cohort.findById(cohortId).lean()
  if (!cohort) throw notFoundError('Cohort not found')
  cohort.programme_name = (await Programme.findById(cohort.programme_id, 'name').lean())?.name ?? null
  const [students, marks] = await Promise.all([
    Student.find({ cohort_id: cohortId, status: { $in: ['active', 'suspended'] } }, 'student_number first_name last_name').sort({ last_name: 1, first_name: 1 }).lean(),
    Attendance.find({ cohort_id: cohortId, date }, 'student_id status').lean(),
  ])
  const byStudent = new Map(marks.map((m) => [String(m.student_id), m.status]))
  res.json({
    cohort, date,
    rows: students.map((s) => ({ student_id: String(s._id), student_number: s.student_number, first_name: s.first_name, last_name: s.last_name, status: byStudent.get(String(s._id)) ?? null })),
  })
})

attendance.put('/sheet', async (req, res) => {
  const b = parse(z.object({ cohortId: id, date: dateStr, records: z.array(z.object({ studentId: id, status: STATUS })).min(1).max(1000) }), req.body)
  if (b.date > new Date().toISOString().slice(0, 10)) throw badRequest('Attendance cannot be recorded for a future date')
  await withTransaction(async (session) => {
    await Attendance.bulkWrite(b.records.map((r) => ({
      updateOne: {
        filter: { cohort_id: b.cohortId, student_id: r.studentId, date: b.date },
        update: { $set: { status: r.status, marked_by: req.user.id } },
        upsert: true,
      },
    })), { session })
    await audit(req, 'attendance.save', 'cohort', b.cohortId, { date: b.date, count: b.records.length }, session)
  })
  res.json({ saved: b.records.length })
})

attendance.get('/dates', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: id }), req.query)
  const rows = await Attendance.aggregate([
    { $match: { cohort_id: oid(cohortId) } },
    { $group: { _id: '$date', marked: { $sum: 1 }, attended: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } } } },
    { $sort: { _id: -1 } },
    { $limit: 200 },
  ])
  res.json(rows.map((r) => ({ date: r._id, marked: r.marked, attended: r.attended })))
})

const reportQuery = z.object({ cohortId: id, from: dateStr.optional(), to: dateStr.optional() })

async function report({ cohortId, from, to }) {
  const { attendance: cfg } = await getSettings()
  const students = await Student.find({ cohort_id: cohortId, status: { $ne: 'archived' } }, 'student_number first_name last_name').sort({ last_name: 1, first_name: 1 }).lean()
  const dateQ = {}
  if (from) dateQ.$gte = from
  if (to) dateQ.$lte = to
  const marks = await Attendance.find({ cohort_id: cohortId, ...(from || to ? { date: dateQ } : {}) }, 'student_id status').lean()
  const counts = new Map()
  for (const m of marks) {
    const c = counts.get(String(m.student_id)) ?? { present: 0, late: 0, absent: 0, excused: 0 }
    c[m.status]++
    counts.set(String(m.student_id), c)
  }
  return {
    threshold: cfg.lowAttendanceThreshold,
    rows: students.map((s) => {
      const c = counts.get(String(s._id)) ?? { present: 0, late: 0, absent: 0, excused: 0 }
      const sessions = c.present + c.late + c.absent + c.excused
      // Excused absences don't count against the student.
      const counted = sessions - c.excused
      const rate = counted ? Math.round(((c.present + c.late) / counted) * 100) : null
      return { student_id: String(s._id), student_number: s.student_number, first_name: s.first_name, last_name: s.last_name, sessions, ...c, rate, low: rate !== null && rate < cfg.lowAttendanceThreshold }
    }),
  }
}

attendance.get('/report', async (req, res) => res.json(await report(parse(reportQuery, req.query))))

attendance.get('/report.csv', async (req, res) => {
  const { rows } = await report(parse(reportQuery, req.query))
  sendCsv(res, 'attendance-report.csv', rows, [
    { key: 'student_number', label: 'Student ID' }, { key: 'first_name', label: 'First name' }, { key: 'last_name', label: 'Last name' },
    { key: 'sessions', label: 'Sessions' }, { key: 'present', label: 'Present' }, { key: 'late', label: 'Late' },
    { key: 'absent', label: 'Absent' }, { key: 'excused', label: 'Excused' }, { key: 'rate', label: 'Attendance %' },
  ])
})

// Emails every student in the cohort whose attendance is below the threshold.
attendance.post('/alerts', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: id }), req.body)
  const { rows, threshold } = await report({ cohortId })
  const low = rows.filter((r) => r.low)
  const students = await byIds(Student, low.map((r) => r.student_id), 'email user_id')
  const users = await byIds(User, [...students.values()].map((s) => s.user_id), 'email')
  const targets = low
    .map((r) => ({ ...r, to: pick(users, students.get(r.student_id)?.user_id, 'email') ?? students.get(r.student_id)?.email }))
    .filter((r) => r.to)
  defer(async () => {
    for (const r of targets) {
      await sendMail({
        to: r.to,
        sentBy: req.user.id,
        subject: 'Attendance notice',
        html: layout({ heading: 'Your attendance is below the required level', paragraphs: [`Hello ${r.first_name}, your attendance is currently ${r.rate}%, below the required ${threshold}%.`, 'Please speak with the academy office if there is anything affecting your attendance.'] }),
      })
    }
  })
  await audit(req, 'attendance.alerts', 'cohort', cohortId, { sent: targets.length })
  res.json({ sent: targets.length, low: low.length })
})
