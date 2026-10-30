// Online video courses for any portal account: browse, buy with Paystack, and watch.
// Listings are public; buying and watching need a signed-in account.
import { z } from 'zod'
import { VideoCourse, VideoLesson, VideoEnrollment, VideoOrder, VideoProgress } from '../db/models.js'
import { withTransaction } from '../db/mongo.js'
import { config } from '../config.js'
import { parse, idParam } from '../lib/validate.js'
import { randomToken } from '../lib/security.js'
import { initializeTransaction, verifyTransaction, paystackEnabled } from '../lib/paystack.js'
import {
  courseAccess, coverUrls, courseCard, lessonStats, playLesson, claimViewer, releaseViewer, isAdmin, liveCourse,
  settleVideoOrder, emailVideoReceipt,
} from '../lib/videos.js'
import { requireAuth } from '../middleware/auth.js'
import { Router, HttpError, badRequest, notFoundError, defer, rateLimit } from '../http.js'

export const videos = new Router()

const published = (user) => (isAdmin(user) ? {} : liveCourse())

// ── Catalogue ────────────────────────────────────────────────────────────────

videos.get('/courses', async (req, res) => {
  const courses = await VideoCourse.find(published(req.user)).sort({ sort_order: 1, created_at: -1 }).lean()
  const [covers, stats, owned] = await Promise.all([
    coverUrls(courses),
    lessonStats(courses.map((c) => c._id)),
    req.user ? VideoEnrollment.find({ user_id: req.user._id, revoked_at: null, $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }] }, 'course_id').lean() : [],
  ])
  const mine = new Set(owned.map((e) => String(e.course_id)))
  res.json(courses.map((c) => courseCard(c, covers, {
    lessons: stats.get(String(c._id))?.lessons ?? 0,
    seconds: stats.get(String(c._id))?.seconds ?? 0,
    owned: mine.has(String(c._id)) || isAdmin(req.user),
  })))
})

videos.get('/courses/:slug', async (req, res) => {
  const course = await VideoCourse.findOne({ slug: String(req.params.slug).toLowerCase(), ...published(req.user) }).lean()
  if (!course) throw notFoundError('Course not found')
  const lessonFilter = { course_id: course._id, ...(isAdmin(req.user) ? {} : { is_published: true }) }
  const [lessons, covers, access, enrollment] = await Promise.all([
    VideoLesson.find(lessonFilter).sort({ sort_order: 1, created_at: 1 }).lean(),
    coverUrls([course]),
    courseAccess(req.user, course),
    req.user ? VideoEnrollment.findOne({ user_id: req.user._id, course_id: course._id, revoked_at: null }).lean() : null,
  ])
  const progress = req.user
    ? new Map((await VideoProgress.find({ user_id: req.user._id, course_id: course._id }).lean()).map((p) => [String(p.lesson_id), p]))
    : new Map()
  res.json({
    ...courseCard(course, covers),
    description: course.description,
    access, // null = signed out, 'preview' = can watch samples, 'full'
    expires_at: enrollment?.expires_at ?? null,
    online_payments: paystackEnabled(),
    lessons: lessons.map((l) => {
      const p = progress.get(String(l._id))
      return {
        id: String(l._id), title: l.title, description: l.description, duration_seconds: l.duration_seconds,
        is_preview: l.is_preview, playable: access === 'full' || (access === 'preview' && l.is_preview),
        ready: Boolean(l.file_id), position_seconds: p?.position_seconds ?? 0, completed: p?.completed ?? false,
      }
    }),
  })
})

// ── Watching ─────────────────────────────────────────────────────────────────

videos.post('/lessons/:id/play', requireAuth, rateLimit({ windowMs: 60_000, limit: 30 }), async (req, res) => {
  res.set('Cache-Control', 'private, no-store')
  res.json(await playLesson(req, idParam(req)))
})

const progressSchema = z.object({
  position: z.coerce.number().min(0).max(24 * 3600),
  duration: z.coerce.number().min(0).max(24 * 3600).optional(),
  playing: z.boolean().default(true),
})

// Heartbeat every ~30 s while playing: saves the position and keeps this device's playback slot.
videos.post('/lessons/:id/progress', requireAuth, async (req, res) => {
  const b = parse(progressSchema, req.body)
  const lesson = await VideoLesson.findById(idParam(req), 'course_id duration_seconds').lean()
  if (!lesson) throw notFoundError('Lesson not found')
  if (b.playing) await claimViewer(req, lesson._id)
  else await releaseViewer(req)
  const duration = b.duration || lesson.duration_seconds
  const completed = Boolean(duration) && b.position >= duration * 0.9
  await VideoProgress.updateOne(
    { user_id: req.user._id, lesson_id: lesson._id },
    { $set: { course_id: lesson.course_id, position_seconds: Math.floor(b.position) }, ...(completed ? { $max: { completed: true } } : {}) },
    { upsert: true },
  )
  // Learn the real running time from the first player that reports it.
  if (b.duration && !lesson.duration_seconds) await VideoLesson.updateOne({ _id: lesson._id }, { $set: { duration_seconds: Math.round(b.duration) } })
  res.json({ ok: true, completed })
})

// ── Buying ───────────────────────────────────────────────────────────────────

videos.post('/courses/:id/checkout', requireAuth, rateLimit({ windowMs: 15 * 60_000, limit: 20 }), async (req, res) => {
  const course = await VideoCourse.findOne({ _id: idParam(req), ...liveCourse() }).lean()
  if (!course) throw notFoundError('Course not found')
  if (!course.price_kobo) throw badRequest('This course is free — just start watching')
  if ((await courseAccess(req.user, course)) === 'full' && !course.access_days) throw badRequest('You already have this course')
  const reference = `VID-${Date.now().toString(36).toUpperCase()}-${randomToken(4).toUpperCase().replace(/[^A-Z0-9]/g, '')}`
  const order = await VideoOrder.create({ user_id: req.user._id, course_id: course._id, amount_kobo: course.price_kobo, reference })
  try {
    const init = await initializeTransaction({
      email: req.user.email,
      amountKobo: course.price_kobo,
      reference,
      callbackUrl: `${config.webUrl}/portal/videos/${course.slug}?reference=${reference}`,
      metadata: { kind: 'video_course', user_id: String(req.user._id), course_id: String(course._id), order_id: String(order._id), course: course.title },
    })
    res.json({ authorizationUrl: init.authorization_url, reference })
  } catch (err) {
    await VideoOrder.updateOne({ _id: order._id }, { $set: { status: 'failed', notes: err.message } })
    throw err
  }
})

// Called when Paystack redirects back; the webhook settles the same order if this never runs.
videos.get('/orders/verify/:reference', requireAuth, async (req, res) => {
  const reference = String(req.params.reference)
  const mine = await VideoOrder.exists({ reference, user_id: req.user._id })
  if (!mine) throw notFoundError('Order not found')
  const data = await verifyTransaction(reference)
  const result = await withTransaction((session) => settleVideoOrder(session, reference, data))
  if (!result) throw new HttpError(404, 'Order not found')
  if (result.newlySettled) defer(() => emailVideoReceipt(result.order._id))
  res.json({ status: result.order.status, amountKobo: result.order.amount_kobo })
})

// Purchases for the signed-in account.
videos.get('/orders', requireAuth, async (req, res) => {
  const orders = await VideoOrder.find({ user_id: req.user._id, status: { $in: ['success', 'pending'] } }, 'course_id amount_kobo reference status paid_at created_at')
    .sort({ created_at: -1 }).limit(50).lean()
  const titles = new Map((await VideoCourse.find({ _id: { $in: orders.map((o) => o.course_id) } }, 'title slug').lean()).map((c) => [String(c._id), c]))
  res.json(orders.map((o) => ({ ...o, course_title: titles.get(String(o.course_id))?.title ?? 'Course', course_slug: titles.get(String(o.course_id))?.slug })))
})

// Stop holding the playback slot (sent when the page closes).
videos.post('/viewer/release', requireAuth, async (req, res) => {
  await releaseViewer(req)
  res.json({ ok: true })
})
