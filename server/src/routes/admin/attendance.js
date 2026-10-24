// Daily attendance sheets, reports and low-attendance alerts (spec §9.3).
import { Router } from 'express'
import { z } from 'zod'
import { many, one, tx } from '../../db/pool.js'
import { parse, id, dateStr } from '../../lib/validate.js'
import { sendCsv } from '../../lib/csv.js'
import { audit } from '../../lib/audit.js'
import { getSettings } from '../../lib/settings.js'
import { sendMail, layout } from '../../lib/mailer.js'
import { badRequest, notFoundError } from '../../middleware/errors.js'

export const attendance = Router()

const STATUS = z.enum(['present', 'absent', 'late', 'excused'])

attendance.get('/sheet', async (req, res) => {
  const { cohortId, date } = parse(z.object({ cohortId: id, date: dateStr }), req.query)
  const cohort = await one('SELECT c.*, p.name AS programme_name FROM cohorts c JOIN programmes p ON p.id = c.programme_id WHERE c.id = $1', [cohortId])
  if (!cohort) throw notFoundError('Cohort not found')
  const rows = await many(
    `SELECT s.id AS student_id, s.student_number, s.first_name, s.last_name, a.status
       FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.cohort_id = $1 AND a.date = $2
      WHERE s.cohort_id = $1 AND s.status IN ('active', 'suspended') ORDER BY s.last_name, s.first_name`,
    [cohortId, date],
  )
  res.json({ cohort, date, rows })
})

attendance.put('/sheet', async (req, res) => {
  const b = parse(z.object({ cohortId: id, date: dateStr, records: z.array(z.object({ studentId: id, status: STATUS })).min(1).max(1000) }), req.body)
  if (b.date > new Date().toISOString().slice(0, 10)) throw badRequest('Attendance cannot be recorded for a future date')
  const n = await tx(async (t) => {
    for (const r of b.records) {
      await t.query(
        `INSERT INTO attendance (cohort_id, student_id, date, status, marked_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (cohort_id, student_id, date) DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by, updated_at = now()`,
        [b.cohortId, r.studentId, b.date, r.status, req.user.id],
      )
    }
    await audit(req, 'attendance.save', 'cohort', b.cohortId, { date: b.date, count: b.records.length }, t)
    return b.records.length
  })
  res.json({ saved: n })
})

attendance.get('/dates', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: id }), req.query)
  res.json(await many(
    `SELECT date, COUNT(*)::int AS marked, COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS attended
       FROM attendance WHERE cohort_id = $1 GROUP BY date ORDER BY date DESC LIMIT 200`,
    [cohortId],
  ))
})

const reportQuery = z.object({ cohortId: id, from: dateStr.optional(), to: dateStr.optional() })

async function report({ cohortId, from, to }) {
  const { attendance: cfg } = await getSettings()
  const rows = await many(
    `SELECT s.id AS student_id, s.student_number, s.first_name, s.last_name,
            COUNT(a.id)::int AS sessions,
            COUNT(a.id) FILTER (WHERE a.status = 'present')::int AS present,
            COUNT(a.id) FILTER (WHERE a.status = 'late')::int AS late,
            COUNT(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
            COUNT(a.id) FILTER (WHERE a.status = 'excused')::int AS excused
       FROM students s
       LEFT JOIN attendance a ON a.student_id = s.id AND a.cohort_id = $1
            AND ($2::date IS NULL OR a.date >= $2) AND ($3::date IS NULL OR a.date <= $3)
      WHERE s.cohort_id = $1 AND s.status <> 'archived'
      GROUP BY s.id ORDER BY s.last_name, s.first_name`,
    [cohortId, from ?? null, to ?? null],
  )
  return {
    threshold: cfg.lowAttendanceThreshold,
    rows: rows.map((r) => {
      // Excused absences don't count against the student.
      const counted = r.sessions - r.excused
      const rate = counted ? Math.round(((r.present + r.late) / counted) * 100) : null
      return { ...r, rate, low: rate !== null && rate < cfg.lowAttendanceThreshold }
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
  const contacts = low.length
    ? await many(`SELECT s.id, COALESCE(u.email, s.email) AS email FROM students s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ANY($1)`, [low.map((r) => r.student_id)])
    : []
  const emails = new Map(contacts.map((c) => [c.id, c.email]))
  let sent = 0
  for (const r of low) {
    const to = emails.get(r.student_id)
    if (!to) continue
    sendMail({
      to,
      sentBy: req.user.id,
      subject: 'Attendance notice',
      html: layout({ heading: 'Your attendance is below the required level', paragraphs: [`Hello ${r.first_name}, your attendance is currently ${r.rate}%, below the required ${threshold}%.`, 'Please speak with the academy office if there is anything affecting your attendance.'] }),
    })
    sent++
  }
  await audit(req, 'attendance.alerts', 'cohort', cohortId, { sent })
  res.json({ sent, low: low.length })
})
