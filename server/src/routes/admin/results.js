// Score entry, CSV upload, automatic grading, publishing, audited corrections and analytics (spec §9.2).
import { Router } from 'express'
import { z } from 'zod'
import { many, one, tx, db } from '../../db/pool.js'
import { config } from '../../config.js'
import { parse, idParam, id, optionalText } from '../../lib/validate.js'
import { upload } from '../../lib/files.js'
import { readCsv, sendCsv } from '../../lib/csv.js'
import { audit } from '../../lib/audit.js'
import { getGradingScheme, getSettings } from '../../lib/settings.js'
import { computeResult, scoreErrors, componentTotals, cohortRanking, studentResultSheet } from '../../lib/results.js'
import { resultSlipPdf } from '../../lib/pdf.js'
import { sendMail, layout } from '../../lib/mailer.js'
import { verificationCode } from '../../lib/security.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { badRequest, notFoundError } from '../../middleware/errors.js'

export const results = Router()

const fieldsOf = (scheme) => scheme.components.flatMap((c) => (c.parts.length ? c.parts : [c]))
// The lowest band is the fail band; anything at or above the next band's minimum is a pass.
const passMark = (scheme) => {
  const mins = scheme.bands.map((b) => b.min).sort((a, b) => a - b)
  return mins[1] ?? mins[0] ?? 50
}

async function context(cohortId, courseId) {
  const cohort = await one('SELECT c.*, p.name AS programme_name FROM cohorts c JOIN programmes p ON p.id = c.programme_id WHERE c.id = $1', [cohortId])
  if (!cohort) throw notFoundError('Cohort not found')
  const course = await one('SELECT * FROM courses WHERE id = $1', [courseId])
  if (!course) throw notFoundError('Course not found')
  const scheme = await getGradingScheme(db, course.grading_scheme_id)
  return { cohort, course, scheme }
}

const sheetQuery = z.object({ cohortId: id, courseId: id })

results.get('/sheet', async (req, res) => {
  const { cohortId, courseId } = parse(sheetQuery, req.query)
  const { cohort, course, scheme } = await context(cohortId, courseId)
  const rows = await many(
    `SELECT s.id AS student_id, s.student_number, s.first_name, s.last_name, s.status AS student_status,
            r.id AS result_id, r.scores, r.total, r.grade, r.remark, r.status, r.published_at, r.updated_at
       FROM students s
       LEFT JOIN results r ON r.student_id = s.id AND r.cohort_id = $1 AND r.course_id = $2
      WHERE (s.cohort_id = $1 AND s.status NOT IN ('archived', 'withdrawn')) OR r.id IS NOT NULL
      ORDER BY s.last_name, s.first_name`,
    [cohortId, courseId],
  )
  res.json({ cohort, course, scheme, rows })
})

const sheetSave = z.object({
  cohortId: id,
  courseId: id,
  reason: optionalText(1000), // required when changing published results
  rows: z.array(z.object({ studentId: id, scores: z.record(z.string(), z.union([z.number(), z.string(), z.null()])), remark: optionalText(200) })).max(1000),
})

// Upserts draft scores. Changing a published result requires a reason and is written to result_corrections.
async function saveScores(req, { cohortId, courseId, reason, rows }) {
  const { scheme } = await context(cohortId, courseId)
  const def = scheme.definition
  const fieldIds = fieldsOf(def).map((f) => f.id)
  const errors = {}
  const clean = []
  for (const r of rows) {
    const values = Object.fromEntries(fieldIds.filter((f) => r.scores[f] !== '' && r.scores[f] != null).map((f) => [f, Number(r.scores[f])]))
    const e = scoreErrors(values, def)
    if (Object.keys(e).length) errors[r.studentId] = e
    clean.push({ ...r, scores: values, empty: Object.keys(values).length === 0 })
  }
  if (Object.keys(errors).length) throw badRequest('Some scores are invalid', errors)

  const allowed = new Set((await many(
    `SELECT id FROM students WHERE id = ANY($1) AND (cohort_id = $2 OR id IN (SELECT student_id FROM results WHERE cohort_id = $2))`,
    [clean.map((r) => r.studentId), cohortId],
  )).map((r) => r.id))
  const outsiders = clean.filter((r) => !allowed.has(r.studentId))
  if (outsiders.length) throw badRequest(`${outsiders.length} student(s) are not in this cohort`)

  return tx(async (t) => {
    let saved = 0
    let corrected = 0
    for (const r of clean) {
      const existing = await t.one('SELECT * FROM results WHERE student_id = $1 AND course_id = $2 AND cohort_id = $3 FOR UPDATE', [r.studentId, courseId, cohortId])
      if (r.empty) {
        if (existing?.status === 'draft') await t.query('DELETE FROM results WHERE id = $1', [existing.id])
        continue
      }
      const { total, grade, remark } = computeResult(r.scores, def)
      const finalRemark = r.remark ?? remark
      if (existing) {
        const sameScores = fieldIds.every((f) => (existing.scores?.[f] ?? null) === (r.scores[f] ?? null))
        const unchanged = sameScores && (existing.remark ?? remark) === finalRemark
        if (unchanged) continue
        if (existing.status === 'published') {
          if (!reason) throw badRequest('Give a reason for changing published results', { reason: 'Required for corrections' })
          await t.query(
            'INSERT INTO result_corrections (result_id, changed_by, reason, before, after) VALUES ($1, $2, $3, $4, $5)',
            [existing.id, req.user.id, reason, { scores: existing.scores, total: existing.total, grade: existing.grade }, { scores: r.scores, total, grade }],
          )
          corrected++
        }
        await t.query(
          `UPDATE results SET scores = $2, total = $3, grade = $4, remark = $5, grading_scheme_id = $6, entered_by = $7, updated_at = now() WHERE id = $1`,
          [existing.id, r.scores, total, grade, finalRemark, scheme.id, req.user.id],
        )
      } else {
        await t.query(
          `INSERT INTO results (student_id, course_id, cohort_id, scores, total, grade, remark, grading_scheme_id, entered_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [r.studentId, courseId, cohortId, r.scores, total, grade, finalRemark, scheme.id, req.user.id],
        )
      }
      saved++
    }
    await audit(req, corrected ? 'results.correct' : 'results.save', 'results', `${cohortId}:${courseId}`, { saved, corrected, reason }, t)
    return { saved, corrected }
  })
}

results.put('/sheet', async (req, res) => {
  res.json(await saveScores(req, parse(sheetSave, req.body)))
})

// CSV template prefilled with the cohort's students and the scheme's score columns.
results.get('/template.csv', async (req, res) => {
  const { cohortId, courseId } = parse(sheetQuery, req.query)
  const { course, scheme } = await context(cohortId, courseId)
  const students = await many(
    `SELECT s.student_number, s.first_name || ' ' || s.last_name AS name, r.scores FROM students s
       LEFT JOIN results r ON r.student_id = s.id AND r.cohort_id = $1 AND r.course_id = $2
      WHERE s.cohort_id = $1 AND s.status NOT IN ('archived', 'withdrawn') ORDER BY s.last_name, s.first_name`,
    [cohortId, courseId],
  )
  const fields = fieldsOf(scheme.definition)
  sendCsv(res, `scores-${course.slug}.csv`, students, [
    { key: 'student_number', label: 'student_id' },
    { key: 'name', label: 'name' },
    ...fields.map((f) => ({ label: f.id, value: (r) => r.scores?.[f.id] ?? '' })),
  ])
})

results.post('/import', upload.single('file'), async (req, res) => {
  const { cohortId, courseId } = parse(sheetQuery, req.query)
  const dryRun = req.query.dryRun === '1'
  if (!req.file) throw badRequest('Attach a CSV file')
  const { scheme } = await context(cohortId, courseId)
  const fields = fieldsOf(scheme.definition)
  let records
  try { records = readCsv(req.file.buffer) } catch (err) { throw badRequest(`Could not read the CSV: ${err.message}`) }
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const students = await many(`SELECT id, upper(student_number) AS num FROM students WHERE cohort_id = $1`, [cohortId])
  const byNumber = new Map(students.map((s) => [s.num, s.id]))

  const errors = []
  const rows = []
  const seen = new Set()
  for (const [i, rec] of records.entries()) {
    const line = i + 2
    const num = String(rec.student_id ?? rec.student_number ?? '').trim().toUpperCase()
    const studentId = byNumber.get(num)
    if (!studentId) { errors.push({ line, error: num ? `Student ${num} is not in this cohort` : 'Missing student_id' }); continue }
    if (seen.has(studentId)) { errors.push({ line, error: `Student ${num} appears more than once` }); continue }
    seen.add(studentId)
    const scores = {}
    for (const f of fields) {
      const key = Object.keys(rec).find((k) => norm(k) === norm(f.id))
      const v = key ? rec[key] : ''
      if (v !== '' && v != null) scores[f.id] = v
    }
    const e = scoreErrors(scores, scheme.definition, { requireAll: true })
    if (Object.keys(e).length) { errors.push({ line, error: Object.entries(e).map(([k, m]) => `${k}: ${m}`).join('; ') }); continue }
    rows.push({ studentId, scores })
  }
  const missing = students.filter((s) => !seen.has(s.id)).length
  if (dryRun || errors.length) return res.json({ dryRun: true, valid: rows.length, errors, missingStudents: missing })
  const out = await saveScores(req, { cohortId, courseId, reason: 'CSV import', rows })
  res.json({ dryRun: false, ...out, missingStudents: missing })
})

// ── Publishing (super admin) ─────────────────────────────────────────────────

results.post('/publish', requireSuperAdmin, async (req, res) => {
  const b = parse(z.object({ cohortId: id, courseId: id.optional().nullable(), publish: z.boolean().default(true), notify: z.boolean().default(true) }), req.body)
  const params = [b.cohortId]
  const courseClause = b.courseId ? `AND course_id = $${params.push(b.courseId)}` : ''
  const { rows } = await db.query(
    b.publish
      ? `UPDATE results SET status = 'published', published_at = now(), updated_at = now() WHERE cohort_id = $1 ${courseClause} AND status = 'draft' RETURNING student_id`
      : `UPDATE results SET status = 'draft', published_at = NULL, updated_at = now() WHERE cohort_id = $1 ${courseClause} AND status = 'published' RETURNING student_id`,
    params,
  )
  await audit(req, b.publish ? 'results.publish' : 'results.unpublish', 'results', `${b.cohortId}:${b.courseId ?? 'all'}`, { count: rows.length })

  if (b.publish && b.notify && rows.length) {
    const ids = [...new Set(rows.map((r) => r.student_id))]
    const recipients = await many(`SELECT s.first_name, COALESCE(u.email, s.email) AS email FROM students s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ANY($1)`, [ids])
    for (const r of recipients.filter((x) => x.email)) {
      sendMail({
        to: r.email,
        sentBy: req.user.id,
        subject: 'New results published',
        html: layout({ heading: 'Your results are available', paragraphs: [`Hello ${r.first_name}, new results have been published to your student portal.`], action: { label: 'View results', url: `${config.webUrl}/portal/results` } }),
      })
    }
  }
  res.json({ updated: rows.length })
})

// ── Corrections log, analytics, exports, slips ───────────────────────────────

results.get('/corrections', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: id.optional() }), req.query)
  res.json(await many(
    `SELECT rc.*, u.full_name AS changed_by_name, s.student_number, s.first_name, s.last_name, c.name AS course_name
       FROM result_corrections rc JOIN results r ON r.id = rc.result_id JOIN students s ON s.id = r.student_id
       JOIN courses c ON c.id = r.course_id LEFT JOIN users u ON u.id = rc.changed_by
      ${cohortId ? 'WHERE r.cohort_id = $1' : ''} ORDER BY rc.created_at DESC LIMIT 200`,
    cohortId ? [cohortId] : [],
  ))
})

results.get('/analytics', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: id }), req.query)
  const scheme = (await getGradingScheme(db)).definition
  const pm = passMark(scheme)
  const [byCourse, ranking, atRisk, grades] = await Promise.all([
    many(
      `SELECT c.id, c.name, COUNT(r.id)::int AS entries, ROUND(AVG(r.total), 1)::float AS average,
              MAX(r.total)::float AS highest, MIN(r.total)::float AS lowest,
              ROUND(100.0 * COUNT(*) FILTER (WHERE r.total >= $2) / NULLIF(COUNT(r.id), 0))::int AS pass_rate,
              COUNT(*) FILTER (WHERE r.status = 'published')::int AS published
         FROM results r JOIN courses c ON c.id = r.course_id WHERE r.cohort_id = $1 GROUP BY c.id ORDER BY c.name`,
      [cohortId, pm],
    ),
    cohortRanking(db, cohortId, { publishedOnly: false }),
    many(
      `SELECT s.id, s.student_number, s.first_name, s.last_name, ROUND(AVG(r.total), 1)::float AS average,
              COUNT(*) FILTER (WHERE r.total < $2)::int AS failed_courses
         FROM results r JOIN students s ON s.id = r.student_id WHERE r.cohort_id = $1
        GROUP BY s.id HAVING COUNT(*) FILTER (WHERE r.total < $2) > 0 OR AVG(r.total) < $2 + 10
        ORDER BY average LIMIT 20`,
      [cohortId, pm],
    ),
    many(`SELECT grade, COUNT(*)::int AS n FROM results WHERE cohort_id = $1 GROUP BY grade ORDER BY grade`, [cohortId]),
  ])
  const names = new Map((await many('SELECT id, student_number, first_name, last_name FROM students WHERE id = ANY($1)', [ranking.map((r) => r.student_id)])).map((s) => [s.id, s]))
  res.json({
    passMark: pm,
    byCourse,
    grades,
    atRisk,
    topPerformers: ranking.slice(0, 10).map((r) => ({ ...r, ...names.get(r.student_id) })),
  })
})

results.get('/export.csv', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: id }), req.query)
  const scheme = (await getGradingScheme(db)).definition
  const rows = await many(
    `SELECT s.student_number, s.first_name, s.last_name, c.name AS course, r.scores, r.total, r.grade, r.remark, r.status
       FROM results r JOIN students s ON s.id = r.student_id JOIN courses c ON c.id = r.course_id
      WHERE r.cohort_id = $1 ORDER BY s.last_name, s.first_name, c.name`,
    [cohortId],
  )
  sendCsv(res, `results-cohort-${cohortId}.csv`, rows, [
    { key: 'student_number', label: 'Student ID' }, { key: 'first_name', label: 'First name' }, { key: 'last_name', label: 'Last name' },
    { key: 'course', label: 'Course' },
    ...fieldsOf(scheme).map((f) => ({ label: f.label, value: (r) => r.scores?.[f.id] ?? '' })),
    ...scheme.components.map((c) => ({ label: `${c.label} total`, value: (r) => componentTotals(r.scores, scheme)[c.id] })),
    { key: 'total', label: 'Total' }, { key: 'grade', label: 'Grade' }, { key: 'remark', label: 'Remark' }, { key: 'status', label: 'Status' },
  ])
})

results.get('/students/:studentId/slip.pdf', async (req, res) => {
  const studentId = idParam(req, 'studentId')
  const { cohortId } = parse(z.object({ cohortId: id }), req.query)
  const student = await one('SELECT * FROM students WHERE id = $1', [studentId])
  const cohort = await one('SELECT c.*, p.name AS programme_name FROM cohorts c JOIN programmes p ON p.id = c.programme_id WHERE c.id = $1', [cohortId])
  if (!student || !cohort) throw notFoundError()
  const { results: rs } = await getSettings()
  const sheet = await studentResultSheet(db, { studentId, cohortId, publishedOnly: true, showPositions: rs.showPositions })
  if (!sheet.rows.length) throw badRequest('This student has no published results in that cohort')
  const code = `RS-${verificationCode(8)}`
  await db.query(
    `INSERT INTO document_verifications (code, kind, student_id, cohort_id, snapshot) VALUES ($1, 'result_slip', $2, $3, $4)`,
    [code, studentId, cohortId, { programme: cohort.programme_name, cohort: cohort.name, rows: sheet.rows.map((r) => ({ course: r.course_name, total: r.total, grade: r.grade })), summary: sheet.summary }],
  )
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="result-slip-${student.student_number.replace(/\//g, '-')}.pdf"`)
  res.send(await resultSlipPdf({ student, cohort, rows: sheet.rows, summary: sheet.summary, verificationCode: code, scheme: sheet.scheme }))
})
