// Programmes, courses, cohorts, grading schemes, course outlines and the timetable builder (spec §5, §8.3.1, §9.3).
import { z } from 'zod'
import { Programme, Course, Cohort, Student, Application, Result, GradingScheme, TimetableEntry, File } from '../../db/models.js'
import { withTransaction } from '../../db/mongo.js'
import { parse, idParam, requiredText, optionalText, optionalDate, kobo, id, optionalId } from '../../lib/validate.js'
import { resolveUpload, sendFile, deleteFile } from '../../lib/storage.js'
import { audit } from '../../lib/audit.js'
import { byIds, pick } from '../../lib/lookup.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { Router, badRequest, notFoundError } from '../../http.js'

export const academics = new Router()

async function outlines(fileIds) {
  const map = await byIds(File, fileIds, 'filename size_bytes status')
  return (fid) => {
    const f = fid && map.get(String(fid))
    return f && f.status === 'ready' ? { filename: f.filename, size: f.size_bytes } : null
  }
}

// ── Programmes ───────────────────────────────────────────────────────────────

academics.get('/programmes', async (req, res) => {
  const rows = await Programme.find().sort({ sort_order: 1, name: 1 }).lean()
  const [courses, outline, students, cohorts] = await Promise.all([
    byIds(Course, rows.flatMap((p) => p.course_ids), 'name'),
    outlines(rows.map((p) => p.outline_file_id)),
    Student.aggregate([{ $match: { status: 'active' } }, { $group: { _id: '$programme_id', n: { $sum: 1 } } }]),
    Cohort.aggregate([{ $group: { _id: '$programme_id', n: { $sum: 1 } } }]),
  ])
  const count = (list, pid) => list.find((x) => String(x._id) === String(pid))?.n ?? 0
  res.json(rows.map((p) => ({
    ...p,
    courses: p.course_ids.map((cid) => ({ id: String(cid), name: pick(courses, cid, 'name') })).filter((c) => c.name),
    outline: outline(p.outline_file_id),
    active_students: count(students, p._id),
    cohort_count: count(cohorts, p._id),
  })))
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
  const doc = {
    slug: b.slug, name: b.name, type: b.type, summary: b.summary, description: b.description, duration_weeks: b.durationWeeks ?? null,
    schedule: b.schedule, fee_kobo: b.feeKobo ?? null, application_fee_kobo: b.applicationFeeKobo, fee_covers: b.feeCovers,
    instalment_plan: b.instalmentPlan, intake_dates: b.intakeDates, application_deadline: b.applicationDeadline ?? null,
    entry_requirements: b.entryRequirements, curriculum: b.curriculum, outcomes: b.outcomes, certificate_awarded: b.certificateAwarded,
    careers: b.careers, is_published: b.isPublished, sort_order: b.sortOrder, course_ids: b.courseIds,
  }
  const row = programmeId
    ? await Programme.findByIdAndUpdate(programmeId, { $set: doc }, { returnDocument: 'after', runValidators: true }).lean()
    : (await Programme.create(doc)).toObject()
  if (!row) throw notFoundError('Programme not found')
  await audit(req, programmeId ? 'programme.update' : 'programme.create', 'programme', row._id, { name: b.name, feeKobo: b.feeKobo, isPublished: b.isPublished })
  return row
}

academics.post('/programmes', async (req, res) => res.status(201).json(await saveProgramme(req, null)))
academics.put('/programmes/:id', async (req, res) => res.json(await saveProgramme(req, idParam(req))))

academics.delete('/programmes/:id', requireSuperAdmin, async (req, res) => {
  const pid = idParam(req)
  const used = (await Student.exists({ programme_id: pid })) || (await Cohort.exists({ programme_id: pid })) || (await Application.exists({ programme_id: pid }))
  if (used) throw badRequest('This programme has cohorts, students or applications. Unpublish it instead of deleting.')
  const p = await Programme.findByIdAndDelete(pid).lean()
  if (p?.outline_file_id) await deleteFile(p.outline_file_id)
  await audit(req, 'programme.delete', 'programme', pid)
  res.json({ ok: true })
})

// ── Courses ──────────────────────────────────────────────────────────────────

academics.get('/courses', async (req, res) => {
  const rows = await Course.find().sort({ name: 1 }).lean()
  const [schemes, programmes, outline] = await Promise.all([
    byIds(GradingScheme, rows.map((c) => c.grading_scheme_id), 'name'),
    Programme.find({ course_ids: { $in: rows.map((c) => c._id) } }, 'name course_ids').lean(),
    outlines(rows.map((c) => c.outline_file_id)),
  ])
  res.json(rows.map((c) => ({
    ...c,
    grading_scheme_name: pick(schemes, c.grading_scheme_id, 'name'),
    programmes: programmes.filter((p) => p.course_ids.some((x) => String(x) === String(c._id))).map((p) => ({ id: String(p._id), name: p.name })),
    outline: outline(c.outline_file_id),
  })))
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
  const row = await Course.create({ slug: b.slug, name: b.name, type: b.type, description: b.description, is_assessed: b.isAssessed, grading_scheme_id: b.gradingSchemeId })
  await audit(req, 'course.create', 'course', row._id, { name: b.name })
  res.status(201).json(row)
})

academics.put('/courses/:id', async (req, res) => {
  const b = parse(courseSchema, req.body)
  const row = await Course.findByIdAndUpdate(
    idParam(req),
    { $set: { slug: b.slug, name: b.name, type: b.type, description: b.description, is_assessed: b.isAssessed, grading_scheme_id: b.gradingSchemeId } },
    { returnDocument: 'after' },
  ).lean()
  if (!row) throw notFoundError()
  await audit(req, 'course.update', 'course', row._id, b)
  res.json(row)
})

academics.delete('/courses/:id', requireSuperAdmin, async (req, res) => {
  const cid = idParam(req)
  if (await Result.exists({ course_id: cid })) throw badRequest('This course has results recorded and cannot be deleted')
  const c = await Course.findByIdAndDelete(cid).lean()
  await Programme.updateMany({ course_ids: cid }, { $pull: { course_ids: cid } })
  if (c?.outline_file_id) await deleteFile(c.outline_file_id)
  await audit(req, 'course.delete', 'course', cid)
  res.json({ ok: true })
})

// ── Course outlines (programme-wide and per course), downloadable in the student portal ──

for (const [path, Model, label] of [['programmes', Programme, 'programme'], ['courses', Course, 'course']]) {
  // Upload: JSON { fileId } from a direct upload, or a small multipart `file`.
  academics.post(`/${path}/:id/outline`, async (req, res) => {
    const rid = idParam(req)
    const current = await Model.findById(rid, 'outline_file_id').lean()
    if (!current) throw notFoundError()
    const f = await resolveUpload(req, { purpose: 'course_outline' })
    if (!f) throw badRequest('Please attach the outline')
    await Model.updateOne({ _id: rid }, { $set: { outline_file_id: f._id } })
    if (current.outline_file_id) await deleteFile(current.outline_file_id)
    await audit(req, `${label}.outline_upload`, label, rid, { filename: f.filename })
    res.status(201).json({ filename: f.filename, size: f.size_bytes })
  })

  academics.get(`/${path}/:id/outline`, async (req, res) => {
    const r = await Model.findById(idParam(req), 'outline_file_id').lean()
    if (!r?.outline_file_id) throw notFoundError('No outline uploaded')
    await sendFile(res, r.outline_file_id, { inline: true })
  })

  academics.delete(`/${path}/:id/outline`, async (req, res) => {
    const rid = idParam(req)
    const r = await Model.findById(rid, 'outline_file_id').lean()
    if (r?.outline_file_id) {
      await Model.updateOne({ _id: rid }, { $set: { outline_file_id: null } })
      await deleteFile(r.outline_file_id)
      await audit(req, `${label}.outline_delete`, label, rid)
    }
    res.json({ ok: true })
  })
}

// ── Cohorts ──────────────────────────────────────────────────────────────────

academics.get('/cohorts', async (req, res) => {
  const { status, programmeId } = parse(z.object({ status: z.string().optional(), programmeId: optionalId }), req.query)
  const q = {}
  if (status) q.status = status
  if (programmeId) q.programme_id = programmeId
  const rows = await Cohort.find(q).lean()
  const [programmes, counts] = await Promise.all([
    byIds(Programme, rows.map((c) => c.programme_id), 'name type'),
    Student.aggregate([{ $match: { status: { $ne: 'archived' }, cohort_id: { $in: rows.map((c) => c._id) } } }, { $group: { _id: '$cohort_id', n: { $sum: 1 } } }]),
  ])
  const countBy = new Map(counts.map((c) => [String(c._id), c.n]))
  rows.sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || (b.starts_on ?? '').localeCompare(a.starts_on ?? '') || a.name.localeCompare(b.name))
  res.json(rows.map((c) => ({
    ...c, programme_name: pick(programmes, c.programme_id, 'name'), programme_type: pick(programmes, c.programme_id, 'type'), student_count: countBy.get(String(c._id)) ?? 0,
  })))
})

academics.get('/cohorts/:id', async (req, res) => {
  const cid = idParam(req)
  const cohort = await Cohort.findById(cid).lean()
  if (!cohort) throw notFoundError('Cohort not found')
  const [programme, students] = await Promise.all([
    Programme.findById(cohort.programme_id, 'name course_ids').lean(),
    Student.find({ cohort_id: cid, status: { $ne: 'archived' } }, 'student_number first_name last_name status email phone').sort({ last_name: 1, first_name: 1 }).lean(),
  ])
  const courses = await byIds(Course, programme?.course_ids ?? [], 'name type')
  res.json({
    ...cohort,
    programme_name: programme?.name ?? null,
    students,
    courses: (programme?.course_ids ?? []).map((x) => courses.get(String(x))).filter(Boolean).map((c) => ({ id: String(c._id), name: c.name, type: c.type })),
  })
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

const cohortDoc = (b) => ({
  programme_id: b.programmeId, name: b.name, sponsor: b.sponsor, sponsor_email: b.sponsorEmail ?? null, starts_on: b.startsOn ?? null,
  ends_on: b.endsOn ?? null, schedule: b.schedule, status: b.status, capacity: b.capacity ?? null, fee_kobo: b.feeKobo ?? null, rules: b.rules, notes: b.notes,
})

academics.post('/cohorts', async (req, res) => {
  const b = parse(cohortSchema, req.body)
  if (!(await Programme.exists({ _id: b.programmeId }))) throw badRequest('Programme not found', { programmeId: 'Not found' })
  const row = await Cohort.create(cohortDoc(b))
  await audit(req, 'cohort.create', 'cohort', row._id, { name: b.name })
  res.status(201).json(row)
})

academics.put('/cohorts/:id', async (req, res) => {
  const b = parse(cohortSchema, req.body)
  const row = await Cohort.findByIdAndUpdate(idParam(req), { $set: cohortDoc(b) }, { returnDocument: 'after' }).lean()
  if (!row) throw notFoundError()
  await audit(req, 'cohort.update', 'cohort', row._id, { name: b.name, status: b.status })
  res.json(row)
})

// Assign (or move) students into a cohort.
academics.post('/cohorts/:id/students', async (req, res) => {
  const cid = idParam(req)
  const { studentIds } = parse(z.object({ studentIds: z.array(id).min(1).max(500) }), req.body)
  const cohort = await Cohort.findById(cid, 'programme_id').lean()
  if (!cohort) throw notFoundError()
  const r = await Student.updateMany({ _id: { $in: studentIds } }, { $set: { cohort_id: cid, programme_id: cohort.programme_id } })
  await audit(req, 'cohort.assign_students', 'cohort', cid, { studentIds })
  res.json({ updated: r.modifiedCount })
})

academics.delete('/cohorts/:id', requireSuperAdmin, async (req, res) => {
  const cid = idParam(req)
  if ((await Student.exists({ cohort_id: cid })) || (await Result.exists({ cohort_id: cid }))) throw badRequest('This cohort has students or results. Archive it instead.')
  await withTransaction(async (session) => {
    await TimetableEntry.deleteMany({ cohort_id: cid }, { session })
    await Cohort.deleteOne({ _id: cid }, { session })
  })
  await audit(req, 'cohort.delete', 'cohort', cid)
  res.json({ ok: true })
})

// ── Grading schemes (bands and components are data — spec §8.3.1) ────────────

academics.get('/grading-schemes', async (req, res) => {
  res.json(await GradingScheme.find().sort({ is_default: -1, name: 1 }).lean())
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
  return withTransaction(async (session) => {
    if (b.isDefault) await GradingScheme.updateMany({ is_default: true, _id: { $ne: schemeId } }, { $set: { is_default: false } }, { session })
    const doc = { name: b.name, definition: b.definition, is_default: b.isDefault }
    const row = schemeId
      ? await GradingScheme.findByIdAndUpdate(schemeId, { $set: doc }, { returnDocument: 'after', session }).lean()
      : (await GradingScheme.create([doc], { session }))[0].toObject()
    if (!row) throw notFoundError()
    await audit(req, schemeId ? 'grading_scheme.update' : 'grading_scheme.create', 'grading_scheme', row._id, b, session)
    return row
  })
}

academics.post('/grading-schemes', requireSuperAdmin, async (req, res) => res.status(201).json(await saveScheme(req, null)))
academics.put('/grading-schemes/:id', requireSuperAdmin, async (req, res) => res.json(await saveScheme(req, idParam(req))))

// ── Timetable builder ────────────────────────────────────────────────────────

academics.get('/timetable', async (req, res) => {
  const { cohortId } = parse(z.object({ cohortId: id }), req.query)
  const rows = await TimetableEntry.find({ cohort_id: cohortId }).sort({ day_of_week: 1, start_time: 1 }).lean()
  const courses = await byIds(Course, rows.map((r) => r.course_id), 'name')
  res.json(rows.map((t) => ({ ...t, course_name: pick(courses, t.course_id, 'name') })))
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

async function assertNoClash(b, excludeId) {
  const clash = await TimetableEntry.findOne({
    cohort_id: b.cohortId, day_of_week: b.dayOfWeek, start_time: { $lt: b.endTime }, end_time: { $gt: b.startTime },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }, 'title').lean()
  if (clash) throw badRequest(`This overlaps with "${clash.title}"`, { startTime: 'Overlaps another class' })
}

const entryDoc = (b) => ({
  cohort_id: b.cohortId, day_of_week: b.dayOfWeek, start_time: b.startTime, end_time: b.endTime, title: b.title,
  course_id: b.courseId, instructor: b.instructor, venue: b.venue,
})

academics.post('/timetable', async (req, res) => {
  const b = parse(entrySchema, req.body)
  await assertNoClash(b)
  res.status(201).json(await TimetableEntry.create(entryDoc(b)))
})

academics.put('/timetable/:id', async (req, res) => {
  const b = parse(entrySchema, req.body)
  await assertNoClash(b, idParam(req))
  const row = await TimetableEntry.findByIdAndUpdate(idParam(req), { $set: entryDoc(b) }, { returnDocument: 'after' }).lean()
  if (!row) throw notFoundError()
  res.json(row)
})

academics.delete('/timetable/:id', async (req, res) => {
  await TimetableEntry.deleteOne({ _id: idParam(req) })
  res.json({ ok: true })
})

// Copies a cohort's weekly timetable to another cohort (handy for new intakes).
academics.post('/timetable/copy', async (req, res) => {
  const { fromCohortId, toCohortId } = parse(z.object({ fromCohortId: id, toCohortId: id }), req.body)
  if (fromCohortId === toCohortId) throw badRequest('Choose a different cohort')
  const copied = await withTransaction(async (session) => {
    const source = await TimetableEntry.find({ cohort_id: fromCohortId }).session(session).lean()
    await TimetableEntry.deleteMany({ cohort_id: toCohortId }, { session })
    if (source.length) await TimetableEntry.insertMany(source.map(({ _id, ...e }) => ({ ...e, cohort_id: toCohortId })), { session })
    return source.length
  })
  res.json({ copied })
})
