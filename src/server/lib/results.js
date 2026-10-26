// Result calculations shared by the student portal, admin analytics and PDF slips (spec §8.3, §9.2).
import { totalScore, gradeFor } from '../../shared/grading.js'
import { getGradingScheme } from './settings.js'
import { Result, Course } from '../db/models.js'
import { oid } from '../db/mongo.js'

const round1 = (n) => Math.round(n * 10) / 10

// Splits stored component scores into the practical/theory columns of the result sheet.
export function componentTotals(scores, scheme) {
  return Object.fromEntries(
    scheme.components.map((c) => [
      c.id,
      c.parts.length ? c.parts.reduce((s, p) => s + (Number(scores?.[p.id]) || 0), 0) : Number(scores?.[c.id]) || 0,
    ]),
  )
}

export function computeResult(scores, scheme) {
  const total = round1(totalScore(scores, scheme))
  const band = gradeFor(total, scheme)
  return { total, grade: band.grade, remark: band.remark }
}

/** Validates scores against the scheme: returns { field: message } for problems (missing, negative, above max). */
export function scoreErrors(scores, scheme, { requireAll = false } = {}) {
  const errors = {}
  for (const f of scheme.components.flatMap((c) => (c.parts.length ? c.parts : [c]))) {
    const raw = scores?.[f.id]
    if (raw === undefined || raw === null || raw === '') {
      if (requireAll) errors[f.id] = 'Missing'
      continue
    }
    const v = Number(raw)
    if (!Number.isFinite(v)) errors[f.id] = 'Not a number'
    else if (v < 0) errors[f.id] = 'Below 0'
    else if (v > f.max) errors[f.id] = `Above maximum (${f.max})`
  }
  return errors
}

/** Average of course totals per student in a cohort, with competition ranking (1, 2, 2, 4). */
export async function cohortRanking(cohortId, { publishedOnly = true } = {}) {
  const match = { cohort_id: oid(cohortId), ...(publishedOnly ? { status: 'published' } : {}) }
  const rows = await Result.aggregate([
    { $match: match },
    { $group: { _id: '$student_id', average: { $avg: '$total' }, courses: { $sum: 1 } } },
    { $sort: { average: -1 } },
  ])
  let lastAvg = null
  let lastPos = 0
  return rows.map((r, i) => {
    const pos = lastAvg !== null && round1(r.average) === round1(lastAvg) ? lastPos : i + 1
    lastAvg = r.average
    lastPos = pos
    return { student_id: String(r._id), average: round1(r.average), courses: r.courses, position: pos, classSize: rows.length }
  })
}

/** A student's results for one cohort, as rows ready for display / PDF, plus a summary. */
export async function studentResultSheet({ studentId, cohortId, publishedOnly = true, showPositions = false }) {
  const scheme = (await getGradingScheme()).definition
  const results = await Result.find({ student_id: studentId, cohort_id: cohortId, ...(publishedOnly ? { status: 'published' } : {}) }).lean()
  const courses = new Map((await Course.find({ _id: { $in: results.map((r) => r.course_id) } }, 'name').lean()).map((c) => [String(c._id), c.name]))
  const display = results
    .map((r) => {
      const parts = componentTotals(r.scores, scheme)
      const band = scheme.bands.find((b) => b.grade === r.grade)
      return {
        id: String(r._id), course_id: String(r.course_id), course_name: courses.get(String(r.course_id)) ?? 'Course', scores: r.scores,
        total: r.total, grade: r.grade, status: r.status, published_at: r.published_at,
        practical: parts.practical ?? null, theory: parts.theory ?? null, remark: r.remark || band?.remark || '',
      }
    })
    .sort((a, b) => a.course_name.localeCompare(b.course_name))
  const average = display.length ? round1(display.reduce((s, r) => s + Number(r.total), 0) / display.length) : null
  const summary = { count: display.length, average, grade: average != null ? gradeFor(average, scheme).grade : null }
  if (showPositions && display.length) {
    const rank = (await cohortRanking(cohortId, { publishedOnly })).find((r) => r.student_id === String(studentId))
    if (rank) Object.assign(summary, { position: rank.position, classSize: rank.classSize })
  }
  return { scheme, rows: display, summary }
}
