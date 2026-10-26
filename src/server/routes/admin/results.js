// Score entry, CSV upload, automatic grading, publishing, audited corrections and analytics (spec §9.2).
import { z } from 'zod'
import { Result, ResultCorrection, Student, Course, Cohort, Programme, User, DocumentVerification } from '../../db/models.js'
import { withTransaction, oid } from '../../db/mongo.js'
import { config } from '../../config.js'
import { parse, idParam, id, optionalText } from '../../lib/validate.js'
import { readCsv, sendCsv } from '../../lib/csv.js'
import { audit } from '../../lib/audit.js'
import { getGradingScheme, getSettings } from '../../lib/settings.js'
import { computeResult, scoreErrors, componentTotals, cohortRanking, studentResultSheet } from '../../lib/results.js'
import { resultSlipPdf } from '../../lib/pdf.js'
import { sendMail, layout } from '../../lib/mailer.js'
import { verificationCode } from '../../lib/security.js'
import { byIds, pick } from '../../lib/lookup.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { Router, badRequest, notFoundError, defer } from '../../http.js'

export const results = new Router()

const fieldsOf = (scheme) => scheme.components.flatMap((c) => (c.parts.length ? c.parts : [c]))
// The lowest band is the fail band; anything at or above the next band's minimum is a pass.
const passMark = (scheme) => {
  const mins = scheme.bands.map((b) => b.min).sort((a, b) => a - b)
  return mins[1] ?? mins[0] ?? 50
}

async function cohortWithProgramme(cohortId) {
  const cohort = await Cohort.findById(cohortId).lean()
  if (!cohort) return null
  return { ...cohort, programme_name: (await Programme.findById(cohort.programme_id, 'name').lean())?.name ?? null }
}

async function context(cohortId, courseId) {
  const cohort = await cohortWithProgramme(cohortId)
  if (!cohort) throw notFoundError('Cohort not found')
  const course = await Course.findById(courseId).lean()
  if (!course) throw notFoundError('Course not found')
  const scheme = await getGradingScheme(course.grading_scheme_id)
  return { cohort, course, scheme }
}

const sheetQuery = z.object({ cohortId: id, courseId: id })

results.get('/sheet', async (req, res) => {
  const { cohortId, courseId } = parse(sheetQuery, req.query)
  const { cohort, course, scheme } = await context(cohortId, courseId)
  const existing = await Result.find({ cohort_id: cohortId, course_id: courseId }).lean()
  const students = await Student.find({
    $or: [{ cohort_id: cohortId, status: { $nin: ['archived', 'withdrawn'] } }, { _id: { $in: existing.map((r) => r.student_id) } }],
  }, 'student_number first_name last_name status').sort({ last_name: 1, first_name: 1 }).lean()
  const byStudent = new Map(existing.map((r) => [String(r.student_id), r]))
  const rows = students.map((s) => {
    const r = byStudent.get(String(s._id))
    return {
      student_id: String(s._id), student_number: s.student_number, first_name: s.first_name, last_name: s.last_name, student_status: s.status,
      result_id: r ? String(r._id) : null, scores: r?.scores ?? null, total: r?.total ?? null, grade: r?.grade ?? null, remark: r?.remark ?? null,
      status: r?.status ?? null, published_at: r?.published_at ?? null, updated_at: r?.updated_at ?? null,
    }
  })
  res.json({ cohort, course, scheme, rows })
})

const sheetSave = z.object({
  cohortId: id,
  courseId: id,
  reason: optionalText(1000), // required when changing published results
  rows: z.array(z.object({ studentId: id, scores: z.record(z.string(), z.union([z.number(), z.string(), z.null()])), remark: optionalText(200) })).max(1000),
})

// Upserts draft scores. Changing a published result requires a reason and is written to result corrections.
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

  const ids = clean.map((r) => oid(r.studentId))
  const inCohort = await Student.find({ _id: { $in: ids }, cohort_id: cohortId }, '_id').lean()
  const withResults = await Result.distinct('student_id', { cohort_id: cohortId, student_id: { $in: ids } })
  const allowed = new Set([...inCohort.map((s) => String(s._id)), ...withResults.map(String)])
  const outsiders = clean.filter((r) => !allowed.has(r.studentId))
  if (outsiders.length) throw badRequest(`${outsiders.length} student(s) are not in this cohort`)

  return withTransaction(async (session) => {
    let saved = 0
    let corrected = 0
    for (const r of clean) {
      const existing = await Result.findOne({ student_id: r.studentId, course_id: courseId, cohort_id: cohortId }).session(session).lean()
      if (r.empty) {
        if (existing?.status === 'draft') await Result.deleteOne({ _id: existing._id }, { session })
        continue
      }
      const { total, grade, remark } = computeResult(r.scores, def)
      const finalRemark = r.remark ?? remark
      if (existing) {
        const sameScores = fieldIds.every((f) => (existing.scores?.[f] ?? null) === (r.scores[f] ?? null))
        if (sameScores && (existing.remark ?? remark) === finalRemark) continue
        if (existing.status === 'published') {
          if (!reason) throw badRequest('Give a reason for changing published results', { reason: 'Required for corrections' })
          await ResultCorrection.create([{
            result_id: existing._id, changed_by: req.user.id, reason,
            before: { scores: existing.scores, total: existing.total, grade: existing.grade }, after: { scores: r.scores, total, grade },
          }], { session })
          corrected++
        }
        await Result.updateOne(
          { _id: existing._id },
          { $set: { scores: r.scores, total, grade, remark: finalRemark, grading_scheme_id: scheme.id, entered_by: req.user.id } },
          { session },
        )
      } else {
        await Result.create([{
          student_id: r.studentId, course_id: courseId, cohort_id: cohortId, scores: r.scores, total, grade, remark: finalRemark,
          grading_scheme_id: scheme.id, entered_by: req.user.id,
        }], { session })
      }
      saved++
    }
    await audit(req, corrected ? 'results.correct' : 'results.save', 'results', `${cohortId}:${courseId}`, { saved, corrected, reason }, session)
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
  const students = await Student.find({ cohort_id: cohortId, status: { $nin: ['archived', 'withdrawn'] } }, 'student_number first_name last_name').sort({ last_name: 1, first_name: 1 }).lean()
  const existing = new Map((await Result.find({ cohort_id: cohortId, course_id: courseId }, 'student_id scores').lean()).map((r) => [String(r.student_id), r.scores]))
  const rows = students.map((s) => ({ student_number: s.student_number, name: `${s.first_name} ${s.last_name}`, scores: existing.get(String(s._id)) }))
  sendCsv(res, `scores-${course.slug}.csv`, rows, [
    { key: 'student_number', label: 'student_id' },
    { key: 'name', label: 'name' },
    ...fieldsOf(scheme.definition).map((f) => ({ label: f.id, value: (r) => r.scores?.[f.id] ?? '' })),
  ])
})

results.post('/import', async (req, res) => {
  const { cohortId, courseId } = parse(sheetQuery, req.query)
  const dryRun = req.query.dryRun === '1'
  if (!req.file) throw badRequest('Attach a CSV file')
  const { scheme } = await context(cohortId, courseId)
  const fields = fieldsOf(scheme.definition)
  let records
  try { records = readCsv(req.file.buffer) } catch (err) { throw badRequest(`Could not read the CSV: ${err.message}`) }
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const students = await Student.find({ cohort_id: cohortId }, 'student_number').lean()
  const byNumber = new Map(students.map((s) => [s.student_number.toUpperCase(), String(s._id)]))

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
  const missing = students.filter((s) => !seen.has(String(s._id))).length
  if (dryRun || errors.length) return res.json({ dryRun: true, valid: rows.length, errors, missingStudents: missing })
  const out = await saveScores(req, { cohortId, courseId, reason: 'CSV import', rows })
  res.json({ dryRun: false, ...out, missingStudents: missing })
})

// ── Publishing (super admin) ─────────────────────────────────────────────────

results.post('/publish', requireSuperAdmin, async (req, res) => {
  const b = parse(z.object({ cohortId: id, courseId: id.optional().nullable(), publish: z.boolean().default(true), notify: z.boolean().default(true) }), req.body)
  const q = { cohort_id: b.cohortId, status: b.publish ? 'draft' : 'published' }
  if (b.courseId) q.course_id = b.courseId
  const affected = await Result.find(q, 'student_id').lean()
  if (affected.length) {
    await Result.updateMany(
      { _id: { $in: affected.map((r) => r._id) } },
      { $set: b.publish ? { status: 'published', published_at: new Date() } : { status: 'draft', published_at: null } },
    )
  }
  await audit(req, b.publish ? 'results.publish' : 'results.unpublish', 'results', `${b.cohortId}:${b.courseId ?? 'all'}`, { count: affected.length })

  if (b.publish && b.notify && affected.length) {
    const ids = [...new Set(affected.map((r) => String(r.student_id)))]
    defer(async () => {
      const students = await Student.find({ _id: { $in: ids } }, 'first_name email user_id').lean()
      const users = await byIds(User, students.map((s) => s.user_id), 'email')
      for (const s of students) {
        const to = pick(users, s.user_id, 'email') ?? s.email
        if (!to) continue
        await sendMail({
          to,
          sentBy: req.user.id,
          subject: 'New results published',
          html: layout({ heading: 'Your results are available', paragraphs: [`Hello ${s.first_name}, new results have been published to your student portal.`], action: { label: 'View results', url: `${config.webUrl}/portal/results` } }),
        })
      }
    })
  }
  res.json({ updated: affected.length })
})

// ── Corrections log, analytics, exports, slips ───────────────────────────────

results.get('/corrections', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: id.optional() }), req.query)
  let resultIds = null
  if (cohortId) resultIds = (await Result.find({ cohort_id: cohortId }, '_id').lean()).map((r) => r._id)
  const rows = await ResultCorrection.find(resultIds ? { result_id: { $in: resultIds } } : {}).sort({ created_at: -1 }).limit(200).lean()
  const resultsById = await byIds(Result, rows.map((r) => r.result_id), 'student_id course_id')
  const [students, courses, users] = await Promise.all([
    byIds(Student, [...resultsById.values()].map((r) => r.student_id), 'student_number first_name last_name'),
    byIds(Course, [...resultsById.values()].map((r) => r.course_id), 'name'),
    byIds(User, rows.map((r) => r.changed_by), 'full_name'),
  ])
  res.json(rows.map((c) => {
    const r = resultsById.get(String(c.result_id))
    return {
      ...c,
      changed_by_name: pick(users, c.changed_by, 'full_name'),
      student_number: pick(students, r?.student_id, 'student_number'), first_name: pick(students, r?.student_id, 'first_name'),
      last_name: pick(students, r?.student_id, 'last_name'), course_name: pick(courses, r?.course_id, 'name'),
    }
  }))
})

results.get('/analytics', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: id }), req.query)
  const scheme = (await getGradingScheme()).definition
  const pm = passMark(scheme)
  const all = await Result.find({ cohort_id: cohortId }, 'student_id course_id total grade status').lean()
  const courses = await byIds(Course, all.map((r) => r.course_id), 'name')
  const round1 = (n) => Math.round(n * 10) / 10

  const byCourseMap = new Map()
  for (const r of all) {
    const k = String(r.course_id)
    const e = byCourseMap.get(k) ?? { id: k, name: pick(courses, r.course_id, 'name'), totals: [], published: 0 }
    e.totals.push(r.total)
    if (r.status === 'published') e.published++
    byCourseMap.set(k, e)
  }
  const byCourse = [...byCourseMap.values()]
    .map((e) => ({
      id: e.id, name: e.name, entries: e.totals.length, average: round1(e.totals.reduce((s, t) => s + t, 0) / e.totals.length),
      highest: Math.max(...e.totals), lowest: Math.min(...e.totals), pass_rate: Math.round((100 * e.totals.filter((t) => t >= pm).length) / e.totals.length),
      published: e.published,
    }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

  const byStudent = new Map()
  for (const r of all) {
    const e = byStudent.get(String(r.student_id)) ?? []
    e.push(r.total)
    byStudent.set(String(r.student_id), e)
  }
  const atRiskRaw = [...byStudent.entries()]
    .map(([sid, totals]) => ({ id: sid, average: round1(totals.reduce((s, t) => s + t, 0) / totals.length), failed_courses: totals.filter((t) => t < pm).length }))
    .filter((x) => x.failed_courses > 0 || x.average < pm + 10)
    .sort((a, b) => a.average - b.average)
    .slice(0, 20)

  const gradeCounts = new Map()
  for (const r of all) gradeCounts.set(r.grade, (gradeCounts.get(r.grade) ?? 0) + 1)
  const ranking = await cohortRanking(cohortId, { publishedOnly: false })
  const names = await byIds(Student, [...ranking.slice(0, 10).map((r) => r.student_id), ...atRiskRaw.map((r) => r.id)], 'student_number first_name last_name')
  const nameFields = (sid) => ({ student_number: pick(names, sid, 'student_number'), first_name: pick(names, sid, 'first_name'), last_name: pick(names, sid, 'last_name') })

  res.json({
    passMark: pm,
    byCourse,
    grades: [...gradeCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([grade, n]) => ({ grade, n })),
    atRisk: atRiskRaw.map((r) => ({ ...r, ...nameFields(r.id) })),
    topPerformers: ranking.slice(0, 10).map((r) => ({ ...r, ...nameFields(r.student_id) })),
  })
})

results.get('/export.csv', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: id }), req.query)
  const scheme = (await getGradingScheme()).definition
  const all = await Result.find({ cohort_id: cohortId }).lean()
  const [students, courses] = await Promise.all([
    byIds(Student, all.map((r) => r.student_id), 'student_number first_name last_name'),
    byIds(Course, all.map((r) => r.course_id), 'name'),
  ])
  const rows = all
    .map((r) => ({
      ...r, student_number: pick(students, r.student_id, 'student_number'), first_name: pick(students, r.student_id, 'first_name'),
      last_name: pick(students, r.student_id, 'last_name') ?? '', course: pick(courses, r.course_id, 'name') ?? '',
    }))
    .sort((a, b) => a.last_name.localeCompare(b.last_name) || a.course.localeCompare(b.course))
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
  const [student, cohort] = await Promise.all([Student.findById(studentId).lean(), cohortWithProgramme(cohortId)])
  if (!student || !cohort) throw notFoundError()
  const { results: rs } = await getSettings()
  const sheet = await studentResultSheet({ studentId, cohortId, publishedOnly: true, showPositions: rs.showPositions })
  if (!sheet.rows.length) throw badRequest('This student has no published results in that cohort')
  const code = `RS-${verificationCode(8)}`
  await DocumentVerification.create({
    code, kind: 'result_slip', student_id: studentId, cohort_id: cohortId,
    snapshot: { programme: cohort.programme_name, cohort: cohort.name, rows: sheet.rows.map((r) => ({ course: r.course_name, total: r.total, grade: r.grade })), summary: sheet.summary },
  })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="result-slip-${student.student_number.replace(/\//g, '-')}.pdf"`)
  res.send(await resultSlipPdf({ student, cohort, rows: sheet.rows, summary: sheet.summary, verificationCode: code, scheme: sheet.scheme }))
})
