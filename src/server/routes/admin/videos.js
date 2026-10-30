// Online video courses: courses, lessons (uploaded videos), who has access, and Paystack orders.
// Staff manage content; prices, access grants and orders are for super admins.
import { z } from 'zod'
import { VideoCourse, VideoLesson, VideoEnrollment, VideoOrder, VideoProgress, User, File } from '../../db/models.js'
import { oid } from '../../db/mongo.js'
import { parse, idParam, id, optionalText, requiredText, kobo, email } from '../../lib/validate.js'
import { resolveUpload, deleteFile } from '../../lib/storage.js'
import { coverUrls, lessonStats, playLesson, grantAccess } from '../../lib/videos.js'
import { audit } from '../../lib/audit.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { Router, badRequest, notFoundError, forbidden } from '../../http.js'

export const videoAdmin = new Router()

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 80) || 'course'

async function uniqueSlug(base, exceptId) {
  let slug = slugify(base)
  for (let n = 2; await VideoCourse.exists({ slug, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }); n++) slug = `${slugify(base)}-${n}`
  return slug
}

const onlySuper = (req, what) => {
  if (req.user.role !== 'super_admin') throw forbidden(`Only a super admin can change ${what}`)
}

// ── Courses ──────────────────────────────────────────────────────────────────

videoAdmin.get('/courses', async (req, res) => {
  const courses = await VideoCourse.find().sort({ sort_order: 1, created_at: -1 }).lean()
  const ids = courses.map((c) => c._id)
  const [covers, stats, learners, sales] = await Promise.all([
    coverUrls(courses),
    lessonStats(ids),
    VideoEnrollment.aggregate([{ $match: { course_id: { $in: ids }, revoked_at: null } }, { $group: { _id: '$course_id', n: { $sum: 1 } } }]),
    VideoOrder.aggregate([{ $match: { course_id: { $in: ids }, status: 'success' } }, { $group: { _id: '$course_id', n: { $sum: 1 }, kobo: { $sum: '$amount_kobo' } } }]),
  ])
  const learnerMap = new Map(learners.map((r) => [String(r._id), r.n]))
  const salesMap = new Map(sales.map((r) => [String(r._id), r]))
  const isSuper = req.user.role === 'super_admin'
  res.json(courses.map((c) => ({
    ...c,
    cover_url: covers.get(String(c.cover_file_id)) ?? null,
    lessons: stats.get(String(c._id))?.lessons ?? 0,
    seconds: stats.get(String(c._id))?.seconds ?? 0,
    learners: learnerMap.get(String(c._id)) ?? 0,
    sales: isSuper ? salesMap.get(String(c._id))?.n ?? 0 : undefined,
    revenue_kobo: isSuper ? salesMap.get(String(c._id))?.kobo ?? 0 : undefined,
  })))
})

const courseSchema = z.object({
  title: requiredText(160),
  slug: z.string().trim().max(80).optional(),
  summary: optionalText(300),
  description: optionalText(8000),
  priceKobo: kobo.default(0),
  accessDays: z.union([z.coerce.number().int().min(1).max(3650), z.literal(''), z.null()]).optional().transform((v) => v || null),
  isPublished: z.boolean().default(false),
  coverFileId: z.union([id, z.literal(''), z.null()]).optional(),
})

async function coverFor(req, current) {
  if (!('coverFileId' in (req.body ?? {}))) return current
  if (!req.body.coverFileId) return null
  if (current && String(current) === String(req.body.coverFileId)) return current
  const file = await resolveUpload(req, { purpose: 'video_cover', field: 'coverFileId' })
  return file._id
}

videoAdmin.post('/courses', async (req, res) => {
  const b = parse(courseSchema, req.body)
  if (b.priceKobo) onlySuper(req, 'course prices')
  const last = await VideoCourse.findOne({}, 'sort_order').sort({ sort_order: -1 }).lean()
  const course = await VideoCourse.create({
    title: b.title, slug: await uniqueSlug(b.slug || b.title), summary: b.summary ?? '', description: b.description ?? '',
    price_kobo: b.priceKobo, access_days: b.accessDays, is_published: b.isPublished,
    cover_file_id: await coverFor(req, null), sort_order: (last?.sort_order ?? 0) + 1, created_by: req.user.id,
  })
  await audit(req, 'video_course.create', 'video_course', course._id, { title: course.title })
  res.status(201).json(course)
})

videoAdmin.get('/courses/:id', async (req, res) => {
  const course = await VideoCourse.findById(idParam(req)).lean()
  if (!course) throw notFoundError('Course not found')
  const lessons = await VideoLesson.find({ course_id: course._id }).sort({ sort_order: 1, created_at: 1 }).lean()
  const files = new Map((await File.find({ _id: { $in: lessons.map((l) => l.file_id).filter(Boolean) } }, 'filename size_bytes mime_type status').lean()).map((f) => [String(f._id), f]))
  const covers = await coverUrls([course])
  res.json({
    ...course,
    cover_url: covers.get(String(course.cover_file_id)) ?? null,
    lessons: lessons.map((l) => ({ ...l, file: l.file_id ? files.get(String(l.file_id)) ?? null : null })),
  })
})

videoAdmin.patch('/courses/:id', async (req, res) => {
  const course = await VideoCourse.findById(idParam(req))
  if (!course) throw notFoundError('Course not found')
  const b = parse(courseSchema.partial({ title: true }), req.body)
  const has = (k) => k in (req.body ?? {})
  if (has('priceKobo') && b.priceKobo !== course.price_kobo) onlySuper(req, 'course prices')
  if (has('accessDays') && b.accessDays !== course.access_days) onlySuper(req, 'access periods')
  if (b.title) course.title = b.title
  if (has('slug') && b.slug) course.slug = await uniqueSlug(b.slug, course._id)
  if (has('summary')) course.summary = b.summary ?? ''
  if (has('description')) course.description = b.description ?? ''
  if (has('priceKobo')) course.price_kobo = b.priceKobo
  if (has('accessDays')) course.access_days = b.accessDays
  if (has('isPublished')) course.is_published = b.isPublished
  const oldCover = course.cover_file_id
  course.cover_file_id = await coverFor(req, course.cover_file_id)
  await course.save()
  if (oldCover && String(oldCover) !== String(course.cover_file_id)) await deleteFile(oldCover)
  await audit(req, 'video_course.update', 'video_course', course._id, { fields: Object.keys(req.body ?? {}) })
  res.json(course)
})

videoAdmin.post('/courses/:id/move', async (req, res) => {
  const { direction } = parse(z.object({ direction: z.enum(['up', 'down']) }), req.body)
  await swap(VideoCourse, {}, idParam(req), direction)
  res.json({ ok: true })
})

videoAdmin.delete('/courses/:id', async (req, res) => {
  const course = await VideoCourse.findById(idParam(req)).lean()
  if (!course) throw notFoundError('Course not found')
  if (await VideoOrder.exists({ course_id: course._id, status: 'success' })) {
    throw badRequest('People have paid for this course, so it can\'t be deleted. Unpublish it instead.')
  }
  const lessons = await VideoLesson.find({ course_id: course._id }, 'file_id').lean()
  for (const l of lessons) await deleteFile(l.file_id)
  await deleteFile(course.cover_file_id)
  await Promise.all([
    VideoLesson.deleteMany({ course_id: course._id }),
    VideoEnrollment.deleteMany({ course_id: course._id }),
    VideoProgress.deleteMany({ course_id: course._id }),
    VideoOrder.deleteMany({ course_id: course._id }),
    VideoCourse.deleteOne({ _id: course._id }),
  ])
  await audit(req, 'video_course.delete', 'video_course', course._id, { title: course.title })
  res.json({ ok: true })
})

/** Swaps sort_order with the neighbouring row (renumbering first so the order is always 1..n). */
async function swap(Model, filter, rowId, direction) {
  const rows = await Model.find(filter, 'sort_order').sort({ sort_order: 1, created_at: 1 }).lean()
  const i = rows.findIndex((r) => String(r._id) === String(rowId))
  if (i < 0) throw notFoundError()
  const j = direction === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= rows.length) return
  ;[rows[i], rows[j]] = [rows[j], rows[i]]
  await Model.bulkWrite(rows.map((r, n) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { sort_order: n + 1 } } } })))
}

// ── Lessons ──────────────────────────────────────────────────────────────────

const lessonSchema = z.object({
  title: requiredText(160),
  description: optionalText(4000),
  fileId: id.optional(),
  isPreview: z.boolean().default(false),
  isPublished: z.boolean().default(true),
})

videoAdmin.post('/courses/:id/lessons', async (req, res) => {
  const course = await VideoCourse.findById(idParam(req), '_id').lean()
  if (!course) throw notFoundError('Course not found')
  const b = parse(lessonSchema, req.body)
  const file = b.fileId ? await resolveUpload(req, { purpose: 'training_video' }) : null
  const last = await VideoLesson.findOne({ course_id: course._id }, 'sort_order').sort({ sort_order: -1 }).lean()
  const lesson = await VideoLesson.create({
    course_id: course._id, title: b.title, description: b.description ?? '', file_id: file?._id ?? null,
    is_preview: b.isPreview, is_published: b.isPublished, sort_order: (last?.sort_order ?? 0) + 1,
  })
  await audit(req, 'video_lesson.create', 'video_lesson', lesson._id, { title: lesson.title })
  res.status(201).json(lesson)
})

videoAdmin.patch('/lessons/:id', async (req, res) => {
  const lesson = await VideoLesson.findById(idParam(req))
  if (!lesson) throw notFoundError('Lesson not found')
  const b = parse(lessonSchema.partial(), req.body)
  const has = (k) => k in (req.body ?? {})
  if (b.title) lesson.title = b.title
  if (has('description')) lesson.description = b.description ?? ''
  if (has('isPreview')) lesson.is_preview = b.isPreview
  if (has('isPublished')) lesson.is_published = b.isPublished
  let oldFile = null
  if (b.fileId && String(b.fileId) !== String(lesson.file_id)) {
    const file = await resolveUpload(req, { purpose: 'training_video' })
    oldFile = lesson.file_id
    lesson.file_id = file._id
    lesson.duration_seconds = null // learnt again from the new video
  }
  await lesson.save()
  if (oldFile) await deleteFile(oldFile)
  await audit(req, 'video_lesson.update', 'video_lesson', lesson._id, { fields: Object.keys(req.body ?? {}) })
  res.json(lesson)
})

videoAdmin.post('/lessons/:id/move', async (req, res) => {
  const { direction } = parse(z.object({ direction: z.enum(['up', 'down']) }), req.body)
  const lesson = await VideoLesson.findById(idParam(req), 'course_id').lean()
  if (!lesson) throw notFoundError('Lesson not found')
  await swap(VideoLesson, { course_id: lesson.course_id }, lesson._id, direction)
  res.json({ ok: true })
})

videoAdmin.delete('/lessons/:id', async (req, res) => {
  const lesson = await VideoLesson.findByIdAndDelete(idParam(req)).lean()
  if (!lesson) throw notFoundError('Lesson not found')
  await deleteFile(lesson.file_id)
  await VideoProgress.deleteMany({ lesson_id: lesson._id })
  await audit(req, 'video_lesson.delete', 'video_lesson', lesson._id, { title: lesson.title })
  res.json({ ok: true })
})

// Admins can watch any lesson to check it.
videoAdmin.post('/lessons/:id/play', async (req, res) => {
  res.set('Cache-Control', 'private, no-store')
  res.json(await playLesson(req, idParam(req)))
})

// ── Learners and orders ──────────────────────────────────────────────────────

videoAdmin.get('/courses/:id/learners', async (req, res) => {
  const courseId = idParam(req)
  const [rows, lessonCount] = await Promise.all([
    VideoEnrollment.find({ course_id: courseId }).sort({ created_at: -1 }).lean(),
    VideoLesson.countDocuments({ course_id: courseId, is_published: true }),
  ])
  const userIds = rows.map((r) => r.user_id)
  const [users, done] = await Promise.all([
    User.find({ _id: { $in: userIds } }, 'email full_name phone role').lean(),
    VideoProgress.aggregate([{ $match: { course_id: oid(courseId), user_id: { $in: userIds }, completed: true } }, { $group: { _id: '$user_id', n: { $sum: 1 } } }]),
  ])
  const userMap = new Map(users.map((u) => [String(u._id), u]))
  const doneMap = new Map(done.map((d) => [String(d._id), d.n]))
  res.json(rows.map((r) => {
    const u = userMap.get(String(r.user_id))
    const now = new Date()
    const status = r.revoked_at ? 'revoked' : r.expires_at && r.expires_at < now ? 'expired' : 'active'
    return {
      id: String(r._id), source: r.source, status, expires_at: r.expires_at, created_at: r.created_at, updated_at: r.updated_at,
      email: u?.email ?? '—', full_name: u?.full_name ?? '', phone: u?.phone ?? null, role: u?.role ?? null,
      completed: doneMap.get(String(r.user_id)) ?? 0, lessons: lessonCount,
    }
  }))
})

// Give access without online payment (cash, bank transfer, scholarship). The person needs a portal account.
videoAdmin.post('/courses/:id/learners', requireSuperAdmin, async (req, res) => {
  const { email: address } = parse(z.object({ email }), req.body)
  const course = await VideoCourse.findById(idParam(req)).lean()
  if (!course) throw notFoundError('Course not found')
  const user = await User.findOne({ email: address }, '_id email').lean()
  if (!user) throw badRequest('No account uses that email yet. Ask them to sign up on the website first.', { email: 'No account found' })
  const enrollment = await grantAccess({ userId: user._id, course, source: 'admin', grantedBy: req.user.id })
  await audit(req, 'video_course.grant', 'video_course', course._id, { email: user.email })
  res.status(201).json(enrollment)
})

videoAdmin.post('/enrollments/:id/revoke', requireSuperAdmin, async (req, res) => {
  const row = await VideoEnrollment.findByIdAndUpdate(idParam(req), { $set: { revoked_at: new Date() } }, { returnDocument: 'after' }).lean()
  if (!row) throw notFoundError()
  await audit(req, 'video_course.revoke', 'video_course', row.course_id, { enrollment: String(row._id) })
  res.json(row)
})

videoAdmin.post('/enrollments/:id/restore', requireSuperAdmin, async (req, res) => {
  const row = await VideoEnrollment.findByIdAndUpdate(idParam(req), { $set: { revoked_at: null } }, { returnDocument: 'after' }).lean()
  if (!row) throw notFoundError()
  await audit(req, 'video_course.restore', 'video_course', row.course_id, { enrollment: String(row._id) })
  res.json(row)
})

videoAdmin.get('/courses/:id/orders', requireSuperAdmin, async (req, res) => {
  const orders = await VideoOrder.find({ course_id: idParam(req) }, '-gateway_response').sort({ created_at: -1 }).limit(500).lean()
  const users = new Map((await User.find({ _id: { $in: orders.map((o) => o.user_id) } }, 'email full_name').lean()).map((u) => [String(u._id), u]))
  res.json(orders.map((o) => ({ ...o, email: users.get(String(o.user_id))?.email ?? '—', full_name: users.get(String(o.user_id))?.full_name ?? '' })))
})
