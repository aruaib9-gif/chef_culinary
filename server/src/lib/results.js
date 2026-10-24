// Result calculations shared by the student portal, admin analytics and PDF slips (spec §8.3, §9.2).
import { totalScore, gradeFor } from '@cca/shared/grading'
import { getGradingScheme } from './settings.js'

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
export async function cohortRanking(db, cohortId, { publishedOnly = true } = {}) {
  const rows = await db.many(
    `SELECT student_id, AVG(total)::float AS average, COUNT(*)::int AS courses
       FROM results WHERE cohort_id = $1 ${publishedOnly ? "AND status = 'published'" : ''}
      GROUP BY student_id ORDER BY average DESC`,
    [cohortId],
  )
  let lastAvg = null
  let lastPos = 0
  return rows.map((r, i) => {
    const pos = lastAvg !== null && round1(r.average) === round1(lastAvg) ? lastPos : i + 1
    lastAvg = r.average
    lastPos = pos
    return { ...r, average: round1(r.average), position: pos, classSize: rows.length }
  })
}

/** A student's results for one cohort, as rows ready for display / PDF, plus a summary. */
export async function studentResultSheet(db, { studentId, cohortId, publishedOnly = true, showPositions = false }) {
  const scheme = (await getGradingScheme(db)).definition
  const rows = await db.many(
    `SELECT r.id, r.course_id, c.name AS course_name, r.scores, r.total, r.grade, r.remark, r.status, r.published_at,
            r.grading_scheme_id
       FROM results r JOIN courses c ON c.id = r.course_id
      WHERE r.student_id = $1 AND r.cohort_id = $2 ${publishedOnly ? "AND r.status = 'published'" : ''}
      ORDER BY c.name`,
    [studentId, cohortId],
  )
  const display = rows.map((r) => {
    const parts = componentTotals(r.scores, scheme)
    const band = scheme.bands.find((b) => b.grade === r.grade)
    return { ...r, practical: parts.practical ?? null, theory: parts.theory ?? null, remark: r.remark || band?.remark || '' }
  })
  const average = display.length ? round1(display.reduce((s, r) => s + Number(r.total), 0) / display.length) : null
  const summary = { count: display.length, average, grade: average != null ? gradeFor(average, scheme).grade : null }
  if (showPositions && display.length) {
    const rank = (await cohortRanking(db, cohortId, { publishedOnly })).find((r) => r.student_id === studentId)
    if (rank) Object.assign(summary, { position: rank.position, classSize: rank.classSize })
  }
  return { scheme, rows: display, summary }
}
