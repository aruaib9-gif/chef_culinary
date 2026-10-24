// Programmes, courses, cohorts, grading schemes and the timetable builder (spec §5, §8.3.1, §9.3).
import { Router } from 'express'
import { z } from 'zod'
import { many, one, query, tx, db } from '../../db/pool.js'
import { parse, idParam, requiredText, optionalText, optionalDate, kobo, id, optionalId } from '../../lib/validate.js'
import { upload, storeFile, sendFile, MATERIAL_TYPES } from '../../lib/files.js'
import { audit } from '../../lib/audit.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { badRequest, notFoundError } from '../../middleware/errors.js'

export const academics = Router()

// Filename/size of an uploaded course outline, or null.
const OUTLINE = (alias) =>
  `(SELECT json_build_object('filename', f.filename, 'size', f.size_bytes) FROM files f WHERE f.id = ${alias}.outline_file_id) AS outline`

// ── Programmes ───────────────────────────────────────────────────────────────

academics.get('/programmes', async (req, res) => {
  res.json(await many(
    `SELECT p.*, ${OUTLINE('p')},
            COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name) ORDER BY pc.sort_order, c.name) FILTER (WHERE c.id IS NOT NULL), '[]') AS courses,
            (SELECT COUNT(*) FROM students s WHERE s.programme_id = p.id AND s.status = 'active')::int AS active_students,
            (SELECT COUNT(*) FROM cohorts co WHERE co.programme_id = p.id)::int AS cohort_count
       FROM programmes p LEFT JOIN programme_courses pc ON pc.programme_id = p.id LEFT JOIN courses c ON c.id = pc.course_id
      GROUP BY p.id ORDER BY p.sort_order, p.name`,
  ))
})

const instalment = z.object({ label: requiredText(60), percent: z.coerce.number().min(1).max(100), dueWeeks: z.coerce.number().int().min(0).max(104) })
const programmeSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes').max(80),
  name: requiredText(160),
  type: z.enum(['professional', 'cohort', 'short']),
  summary: optionalText(500),
  description: optionalText(10000),
  durationWeeks: z.coerce.number().int().min(1).max(260).optional().nullable(),
  schedule: optionalText(200),
  feeKobo: kobo.optional().nullable(),
  applicationFeeKobo: kobo.default(0),
  feeCovers: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  instalmentPlan: z.array(instalment).max(12).default([]).refine(
    (plan) => plan.length === 0 || Math.round(plan.reduce((s, p) => s + p.percent, 0)) === 100,
    'Instalment percentages must add up to 100',
  ),
  intakeDates: optionalText(500),
  applicationDeadline: optionalDate,
  entryRequirements: optionalText(5000),
  curriculum: optionalText(10000),
  outcomes: optionalText(5000),
  certificateAwarded: optionalText(300),
  careers: optionalText(5000),
  isPublished: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
  courseIds: z.array(id).max(100).default([]),
})

async function saveProgramme(req, programmeId) {
  const b = parse(programmeSchema, req.body)
  const values = [b.slug, b.name, b.type, b.summary, b.description, b.durationWeeks ?? null, b.schedule, b.feeKobo ?? null, b.applicationFeeKobo,
    JSON.stringify(b.feeCovers), JSON.stringify(b.instalmentPlan), b.intakeDates, b.applicationDeadline ?? null, b.entryRequirements, b.curriculum,
    b.outcomes, b.certificateAwarded, b.careers, b.isPublished, b.sortOrder]
  return tx(async (t) => {
    const cols = `slug, name, type, summary, description, duration_weeks, schedule, fee_kobo, application_fee_kobo, fee_covers, instalment_plan,
                  intake_dates, application_deadline, entry_requirements, curriculum, outcomes, certificate_awarded, careers, is_published, sort_order`
    const row = programmeId
      ? await t.one(`UPDATE programmes SET (${cols}, updated_at) = ($2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, now()) WHERE id = $1 RETURNING *`, [programmeId, ...values])
      : await t.one(`INSERT INTO programmes (${cols}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`, values)
    if (!row) throw notFoundError('Programme not found')
    await t.query('DELETE FROM programme_courses WHERE programme_id = $1', [row.id])
    for (const [i, courseId] of b.courseIds.entries()) {
      await t.query('INSERT INTO programme_courses (programme_id, course_id, sort_order) VALUES ($1, $2, $3)', [row.id, courseId, i])
    }
    await audit(req, programmeId ? 'programme.update' : 'programme.create', 'programme', row.id, { name: b.name, feeKobo: b.feeKobo, isPublished: b.isPublished }, t)
    return row
  })
}

academics.post('/programmes', async (req, res) => res.status(201).json(await saveProgramme(req, null)))
academics.put('/programmes/:id', async (req, res) => res.json(await saveProgramme(req, idParam(req))))

academics.delete('/programmes/:id', requireSuperAdmin, async (req, res) => {
  const pid = idParam(req)
  const used = await one('SELECT (SELECT COUNT(*) FROM students WHERE programme_id = $1) + (SELECT COUNT(*) FROM cohorts WHERE programme_id = $1) + (SELECT COUNT(*) FROM applications WHERE programme_id = $1) AS n', [pid])
  if (Number(used.n) > 0) throw badRequest('This programme has cohorts, students or applications. Unpublish it instead of deleting.')
  await query('DELETE FROM programmes WHERE id = $1', [pid])
  await audit(req, 'programme.delete', 'programme', pid)
  res.json({ ok: true })
})

// ── Courses ──────────────────────────────────────────────────────────────────

academics.get('/courses', async (req, res) => {
  res.json(await many(
    `SELECT c.*, g.name AS grading_scheme_name, ${OUTLINE('c')},
            COALESCE(json_agg(json_build_object('id', p.id, 'name', p.name)) FILTER (WHERE p.id IS NOT NULL), '[]') AS programmes
       FROM courses c LEFT JOIN grading_schemes g ON g.id = c.grading_scheme_id
       LEFT JOIN programme_courses pc ON pc.course_id = c.id LEFT JOIN programmes p ON p.id = pc.programme_id
      GROUP BY c.id, g.name ORDER BY c.name`,
  ))
})

const courseSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes').max(80),
  name: requiredText(160),
  type: z.enum(['Theory', 'Practical', 'Theory and practical']),
  description: optionalText(5000),
  isAssessed: z.boolean().default(true),
  gradingSchemeId: optionalId,
})

academics.post('/courses', async (req, res) => {
  const b = parse(courseSchema, req.body)
  const row = await one(
    'INSERT INTO courses (slug, name, type, description, is_assessed, grading_scheme_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [b.slug, b.name, b.type, b.description, b.isAssessed, b.gradingSchemeId],
  )
  await audit(req, 'course.create', 'course', row.id, { name: b.name })
  res.status(201).json(row)
})

academics.put('/courses/:id', async (req, res) => {
  const b = parse(courseSchema, req.body)
  const row = await one(
    'UPDATE courses SET slug = $2, name = $3, type = $4, description = $5, is_assessed = $6, grading_scheme_id = $7 WHERE id = $1 RETURNING *',
    [idParam(req), b.slug, b.name, b.type, b.description, b.isAssessed, b.gradingSchemeId],
  )
  if (!row) throw notFoundError()
  await audit(req, 'course.update', 'course', row.id, b)
  res.json(row)
})

academics.delete('/courses/:id', requireSuperAdmin, async (req, res) => {
  const cid = idParam(req)
  if (await one('SELECT 1 FROM results WHERE course_id = $1 LIMIT 1', [cid])) throw badRequest('This course has results recorded and cannot be deleted')
  await query('DELETE FROM courses WHERE id = $1', [cid])
  await audit(req, 'course.delete', 'course', cid)
  res.json({ ok: true })
})

// ── Cohorts ──────────────────────────────────────────────────────────────────

academics.get('/cohorts', async (req, res) => {
  const { status, programmeId } = parse(z.object({ status: z.string().optional(), programmeId: optionalId }), req.query)
  const params = []
  const where = []
  if (status) where.push(`c.status = $${params.push(status)}`)
  if (programmeId) where.push(`c.programme_id = $${params.push(programmeId)}`)
  res.json(await many(
    `SELECT c.*, p.name AS programme_name, p.type AS programme_type,
            (SELECT COUNT(*) FROM students s WHERE s.cohort_id = c.id AND s.status <> 'archived')::int AS student_count
       FROM cohorts c JOIN programmes p ON p.id = c.programme_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (c.status = 'active') DESC, c.starts_on DESC NULLS LAST, c.name`,
    params,
  ))
})

academics.get('/cohorts/:id', async (req, res) => {
  const cid = idParam(req)
  const cohort = await one('SELECT c.*, p.name AS programme_name FROM cohorts c JOIN programmes p ON p.id = c.programme_id WHERE c.id = $1', [cid])
  if (!cohort) throw notFoundError('Cohort not found')
  const [students, courses] = await Promise.all([
    many(`SELECT id, student_number, first_name, last_name, status, email, phone FROM students WHERE cohort_id = $1 AND status <> 'archived' ORDER BY last_name, first_name`, [cid]),
    many(`SELECT c.id, c.name, c.type FROM courses c JOIN programme_courses pc ON pc.course_id = c.id WHERE pc.programme_id = $1 ORDER BY pc.sort_order, c.name`, [cohort.programme_id]),
  ])
  res.json({ ...cohort, students, courses })
})

const cohortSchema = z.object({
  programmeId: id,
  name: requiredText(120),
  sponsor: optionalText(160),
  sponsorEmail: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('').transform(() => null)),
  startsOn: optionalDate,
  endsOn: optionalDate,
  schedule: optionalText(200),
  status: z.enum(['planned', 'active', 'completed', 'archived']).default('active'),
  capacity: z.coerce.number().int().min(1).max(1000).optional().nullable(),
  feeKobo: kobo.optional().nullable(),
  rules: optionalText(20000),
  notes: optionalText(5000),
}).refine((c) => !c.startsOn || !c.endsOn || c.endsOn >= c.startsOn, { message: 'End date must be after start date', path: ['endsOn'] })

const cohortValues = (b) => [b.programmeId, b.name, b.sponsor, b.sponsorEmail ?? null, b.startsOn ?? null, b.endsOn ?? null, b.schedule, b.status, b.capacity ?? null, b.feeKobo ?? null, b.rules, b.notes]

academics.post('/cohorts', async (req, res) => {
  const b = parse(cohortSchema, req.body)
  const row = await one(
    `INSERT INTO cohorts (programme_id, name, sponsor, sponsor_email, starts_on, ends_on, schedule, status, capacity, fee_kobo, rules, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    cohortValues(b),
  )
  await audit(req, 'cohort.create', 'cohort', row.id, { name: b.name })
  res.status(201).json(row)
})

academics.put('/cohorts/:id', async (req, res) => {
  const b = parse(cohortSchema, req.body)
  const row = await one(
    `UPDATE cohorts SET (programme_id, name, sponsor, sponsor_email, starts_on, ends_on, schedule, status, capacity, fee_kobo, rules, notes)
       = ($2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) WHERE id = $1 RETURNING *`,
    [idParam(req), ...cohortValues(b)],
  )
  if (!row) throw notFoundError()
  await audit(req, 'cohort.update', 'cohort', row.id, { name: b.name, status: b.status })
  res.json(row)
})

// Assign (or move) students into a cohort.
academics.post('/cohorts/:id/students', async (req, res) => {
  const cid = idParam(req)
  const { studentIds } = parse(z.object({ studentIds: z.array(id).min(1).max(500) }), req.body)
  const cohort = await one('SELECT programme_id FROM cohorts WHERE id = $1', [cid])
  if (!cohort) throw notFoundError()
  const { rowCount } = await query(
    'UPDATE students SET cohort_id = $1, programme_id = $2, updated_at = now() WHERE id = ANY($3)',
    [cid, cohort.programme_id, studentIds],
  )
  await audit(req, 'cohort.assign_students', 'cohort', cid, { studentIds })
  res.json({ updated: rowCount })
})

academics.delete('/cohorts/:id', requireSuperAdmin, async (req, res) => {
  const cid = idParam(req)
  const used = await one('SELECT (SELECT COUNT(*) FROM students WHERE cohort_id = $1) + (SELECT COUNT(*) FROM results WHERE cohort_id = $1) AS n', [cid])
  if (Number(used.n) > 0) throw badRequest('This cohort has students or results. Archive it instead.')
  await query('DELETE FROM cohorts WHERE id = $1', [cid])
  await audit(req, 'cohort.delete', 'cohort', cid)
  res.json({ ok: true })
})

// ── Grading schemes (bands and components are data — spec §8.3.1) ────────────

academics.get('/grading-schemes', async (req, res) => {
  res.json(await many('SELECT * FROM grading_schemes ORDER BY is_default DESC, name'))
})

const part = z.object({ id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,40}$/, 'Letters, numbers and _ only'), label: requiredText(120), max: z.coerce.number().positive().max(100) })
const schemeSchema = z.object({
  name: requiredText(120),
  isDefault: z.boolean().default(false),
  definition: z.object({
    bands: z.array(z.object({ grade: requiredText(5), min: z.coerce.number().min(0).max(100), max: z.coerce.number().min(0).max(100), remark: requiredText(80) })).min(1).max(15),
    components: z.array(part.extend({ parts: z.array(part).max(10).default([]) })).min(1).max(10),
  }).superRefine((d, ctx) => {
    for (const [i, c] of d.components.entries()) {
      if (c.parts.length && Math.abs(c.parts.reduce((s, p) => s + p.max, 0) - c.max) > 0.001) {
        ctx.addIssue({ code: 'custom', path: ['components', i, 'max'], message: `Parts of "${c.label}" must add up to ${c.max}` })
      }
    }
    const total = d.components.reduce((s, c) => s + c.max, 0)
    if (Math.abs(total - 100) > 0.001) ctx.addIssue({ code: 'custom', path: ['components'], message: `Component maximums add up to ${total}; they must total 100` })
    const ids = d.components.flatMap((c) => [c.id, ...c.parts.map((p) => p.id)])
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['components'], message: 'Component ids must be unique' })
    for (const [i, b] of d.bands.entries()) if (b.min > b.max) ctx.addIssue({ code: 'custom', path: ['bands', i, 'min'], message: 'Min is above max' })
  }),
})

async function saveScheme(req, schemeId) {
  const b = parse(schemeSchema, req.body)
  return tx(async (t) => {
    if (b.isDefault) await t.query('UPDATE grading_schemes SET is_default = false WHERE is_default')
    const row = schemeId
      ? await t.one('UPDATE grading_schemes SET name = $2, definition = $3, is_default = $4, updated_at = now() WHERE id = $1 RETURNING *', [schemeId, b.name, b.definition, b.isDefault])
      : await t.one('INSERT INTO grading_schemes (name, definition, is_default) VALUES ($1, $2, $3) RETURNING *', [b.name, b.definition, b.isDefault])
    if (!row) throw notFoundError()
    await audit(req, schemeId ? 'grading_scheme.update' : 'grading_scheme.create', 'grading_scheme', row.id, b, t)
    return row
  })
}

academics.post('/grading-schemes', requireSuperAdmin, async (req, res) => res.status(201).json(await saveScheme(req, null)))
academics.put('/grading-schemes/:id', requireSuperAdmin, async (req, res) => res.json(await saveScheme(req, idParam(req))))

// ── Timetable builder ────────────────────────────────────────────────────────

academics.get('/timetable', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: id }), req.query)
  res.json(await many(
    `SELECT t.id, t.cohort_id, t.day_of_week, to_char(t.start_time, 'HH24:MI') AS start_time, to_char(t.end_time, 'HH24:MI') AS end_time,
            t.title, t.course_id, t.instructor, t.venue, c.name AS course_name
       FROM timetable_entries t LEFT JOIN courses c ON c.id = t.course_id
      WHERE t.cohort_id = $1 ORDER BY t.day_of_week, t.start_time`,
    [cohortId],
  ))
})

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
const entrySchema = z.object({
  cohortId: id,
  dayOfWeek: z.coerce.number().int().min(1).max(7),
  startTime: time,
  endTime: time,
  title: requiredText(160),
  courseId: optionalId,
  instructor: optionalText(120),
  venue: optionalText(120),
}).refine((e) => e.endTime > e.startTime, { message: 'End time must be after start time', path: ['endTime'] })

async function assertNoClash(b, excludeId = 0) {
  const clash = await one(
    `SELECT title FROM timetable_entries WHERE cohort_id = $1 AND day_of_week = $2 AND id <> $5
        AND start_time < $4::time AND end_time > $3::time`,
    [b.cohortId, b.dayOfWeek, b.startTime, b.endTime, excludeId],
  )
  if (clash) throw badRequest(`This overlaps with "${clash.title}"`, { startTime: 'Overlaps another class' })
}

academics.post('/timetable', async (req, res) => {
  const b = parse(entrySchema, req.body)
  await assertNoClash(b)
  const row = await one(
    `INSERT INTO timetable_entries (cohort_id, day_of_week, start_time, end_time, title, course_id, instructor, venue)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [b.cohortId, b.dayOfWeek, b.startTime, b.endTime, b.title, b.courseId, b.instructor, b.venue],
  )
  res.status(201).json(row)
})

academics.put('/timetable/:id', async (req, res) => {
  const b = parse(entrySchema, req.body)
  await assertNoClash(b, idParam(req))
  const row = await one(
    `UPDATE timetable_entries SET cohort_id = $2, day_of_week = $3, start_time = $4, end_time = $5, title = $6, course_id = $7, instructor = $8, venue = $9
      WHERE id = $1 RETURNING *`,
    [idParam(req), b.cohortId, b.dayOfWeek, b.startTime, b.endTime, b.title, b.courseId, b.instructor, b.venue],
  )
  if (!row) throw notFoundError()
  res.json(row)
})

academics.delete('/timetable/:id', async (req, res) => {
  await query('DELETE FROM timetable_entries WHERE id = $1', [idParam(req)])
  res.json({ ok: true })
})

// Copies a cohort's weekly timetable to another cohort (handy for new intakes).
academics.post('/timetable/copy', async (req, res) => {
  const { fromCohortId, toCohortId } = parse(z.object({ fromCohortId: id, toCohortId: id }), req.body)
  if (fromCohortId === toCohortId) throw badRequest('Choose a different cohort')
  const { rowCount } = await tx(async (t) => {
    await t.query('DELETE FROM timetable_entries WHERE cohort_id = $1', [toCohortId])
    return t.query(
      `INSERT INTO timetable_entries (cohort_id, day_of_week, start_time, end_time, title, course_id, instructor, venue)
       SELECT $2, day_of_week, start_time, end_time, title, course_id, instructor, venue FROM timetable_entries WHERE cohort_id = $1`,
      [fromCohortId, toCohortId],
    )
  })
  res.json({ copied: rowCount })
})

// ── Course outlines (programme-wide and per course), downloadable in the student portal ──

for (const [path, table, label] of [['programmes', 'programmes', 'programme'], ['courses', 'courses', 'course']]) {
  academics.post(`/${path}/:id/outline`, upload.single('file'), async (req, res) => {
    const rid = idParam(req)
    const row = await tx(async (t) => {
      const current = await t.one(`SELECT outline_file_id FROM ${table} WHERE id = $1`, [rid])
      if (!current) throw notFoundError()
      const f = await storeFile(t, req.file, req.user.id, MATERIAL_TYPES)
      await t.query(`UPDATE ${table} SET outline_file_id = $2 WHERE id = $1`, [rid, f.id])
      if (current.outline_file_id) await t.query('DELETE FROM files WHERE id = $1', [current.outline_file_id])
      await audit(req, `${label}.outline_upload`, label, rid, { filename: f.filename }, t)
      return f
    })
    res.status(201).json({ filename: row.filename, size: row.size_bytes })
  })

  academics.get(`/${path}/:id/outline`, async (req, res) => {
    const r = await one(`SELECT outline_file_id FROM ${table} WHERE id = $1`, [idParam(req)])
    if (!r?.outline_file_id) throw notFoundError('No outline uploaded')
    await sendFile(res, db, r.outline_file_id, { inline: true })
  })

  academics.delete(`/${path}/:id/outline`, async (req, res) => {
    const rid = idParam(req)
    const r = await one(`SELECT outline_file_id FROM ${table} WHERE id = $1`, [rid])
    if (r?.outline_file_id) {
      await tx(async (t) => {
        await t.query(`UPDATE ${table} SET outline_file_id = NULL WHERE id = $1`, [rid])
        await t.query('DELETE FROM files WHERE id = $1', [r.outline_file_id])
      })
      await audit(req, `${label}.outline_delete`, label, rid)
    }
    res.json({ ok: true })
  })
}
