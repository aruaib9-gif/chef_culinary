// Online video courses: who can watch what, playback links, and settling Paystack orders.
import { VideoCourse, VideoLesson, VideoEnrollment, VideoOrder, VideoViewer, File, User } from '../db/models.js'
import { presignGet, signedUrls } from './storage.js'
import { sendMail, layout } from './mailer.js'
import { config } from '../config.js'
import { ADMIN_ROLES } from '../middleware/auth.js'
import { HttpError, forbidden, notFoundError } from '../http.js'

export const PLAY_TTL = 2 * 60 * 60 // playback links expire after 2 hours; the player fetches a fresh one
const VIEWER_STALE_MS = 75_000 // another device may take over after this long without a heartbeat

export const isAdmin = (user) => ADMIN_ROLES.includes(user?.role)

const activeEnrollment = (userId, courseId) =>
  VideoEnrollment.findOne({
    user_id: userId, course_id: courseId, revoked_at: null,
    $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }],
  }).lean()

/** 'full' (paid, free course, or staff), 'preview' (only sample lessons) or null (not signed in). */
export async function courseAccess(user, course) {
  if (!user) return null
  if (isAdmin(user)) return 'full'
  if (!course.price_kobo) return 'full'
  return (await activeEnrollment(user._id, course._id)) ? 'full' : 'preview'
}

/** Mongo filter for courses learners can see: published, and any scheduled time has arrived. */
export const liveCourse = () => ({ is_published: true, $or: [{ publish_at: null }, { publish_at: { $lte: new Date() } }] })
export const isLive = (c) => Boolean(c.is_published && (!c.publish_at || new Date(c.publish_at) <= new Date()))
/** 'draft' | 'scheduled' | 'published', for the admin screens. */
export const publishState = (c) => (!c.is_published ? 'draft' : isLive(c) ? 'published' : 'scheduled')

export async function coverUrls(courses) {
  return signedUrls(courses.map((c) => c.cover_file_id), { expiresIn: 6 * 60 * 60 })
}

/** Public shape of a course for listings. */
export function courseCard(c, covers, extra = {}) {
  return {
    id: String(c._id), slug: c.slug, title: c.title, summary: c.summary, price_kobo: c.price_kobo, access_days: c.access_days,
    cover_url: covers.get(String(c.cover_file_id)) ?? null, ...extra,
  }
}

/** Lesson counts and total running time per course. */
export async function lessonStats(courseIds) {
  const rows = await VideoLesson.aggregate([
    { $match: { course_id: { $in: courseIds }, is_published: true } },
    { $group: { _id: '$course_id', lessons: { $sum: 1 }, seconds: { $sum: { $ifNull: ['$duration_seconds', 0] } } } },
  ])
  return new Map(rows.map((r) => [String(r._id), { lessons: r.lessons, seconds: r.seconds }]))
}

/**
 * Checks the viewer may play this lesson right now and returns a short-lived link to the video.
 * One device at a time: a second session is refused while the first is still sending heartbeats.
 */
export async function playLesson(req, lessonId) {
  const lesson = await VideoLesson.findById(lessonId).lean()
  if (!lesson) throw notFoundError('Lesson not found')
  const course = await VideoCourse.findById(lesson.course_id).lean()
  const staff = isAdmin(req.user)
  if (!course || (!staff && (!isLive(course) || !lesson.is_published))) throw notFoundError('Lesson not found')
  const access = await courseAccess(req.user, course)
  if (access !== 'full' && !lesson.is_preview) throw new HttpError(402, 'Buy this course to watch this lesson')

  if (!staff) {
    await claimViewer(req, lesson._id)
    if (!course.price_kobo) {
      // Record free-course learners so admins can see who is taking them.
      await VideoEnrollment.updateOne(
        { user_id: req.user._id, course_id: course._id },
        { $setOnInsert: { source: 'free' } },
        { upsert: true },
      )
    }
  }

  if (lesson.provider !== 'storage' || !lesson.file_id) throw new HttpError(409, 'This video is not available yet')
  const file = await File.findById(lesson.file_id).lean()
  if (!file || file.status !== 'ready') throw new HttpError(409, 'This video is still processing')
  // Inline, with a generic name: there is no download prompt and the link dies after PLAY_TTL.
  const url = await presignGet(file.key, 'lesson', file.mime_type, true, PLAY_TTL)
  return { url, type: file.mime_type, expiresAt: new Date(Date.now() + PLAY_TTL * 1000).toISOString() }
}

/** Takes (or keeps) this account's single playback slot for the current session. */
export async function claimViewer(req, lessonId) {
  if (isAdmin(req.user)) return
  const now = new Date()
  const current = await VideoViewer.findOne({ user_id: req.user._id }).lean()
  const otherDevice = current && String(current.session_id) !== String(req.sessionId) && now - current.last_seen_at < VIEWER_STALE_MS
  if (otherDevice) {
    throw new HttpError(409, 'This account is already watching on another device. Stop the video there, or wait a minute and try again.')
  }
  await VideoViewer.updateOne(
    { user_id: req.user._id },
    { $set: { session_id: req.sessionId, lesson_id: lessonId, last_seen_at: now } },
    { upsert: true },
  )
}

/** Releases the slot when the viewer stops playing (pause, leaving the page). */
export async function releaseViewer(req) {
  await VideoViewer.deleteOne({ user_id: req.user._id, session_id: req.sessionId })
}

export async function assertCanWatch(user, course) {
  if ((await courseAccess(user, course)) !== 'full') throw forbidden('You do not have access to this course')
}

// ── Orders ───────────────────────────────────────────────────────────────────

export const isVideoReference = (reference) => String(reference).startsWith('VID-')

/** Gives (or extends) access after a successful payment or an admin grant. */
export async function grantAccess({ userId, course, source, orderId = null, grantedBy = null }, session) {
  const existing = await VideoEnrollment.findOne({ user_id: userId, course_id: course._id }).session(session ?? null).lean()
  let expiresAt = null
  if (course.access_days) {
    const stillValid = existing && !existing.revoked_at && existing.expires_at && existing.expires_at > new Date()
    const from = stillValid ? existing.expires_at.getTime() : Date.now()
    expiresAt = new Date(from + course.access_days * 86400_000)
  }
  return VideoEnrollment.findOneAndUpdate(
    { user_id: userId, course_id: course._id },
    { $set: { source, order_id: orderId, granted_by: grantedBy, expires_at: expiresAt, revoked_at: null } },
    { upsert: true, returnDocument: 'after', session },
  ).lean()
}

/** Settles a Paystack video order after verifying it with the gateway. Safe to call more than once. */
export async function settleVideoOrder(session, reference, gatewayData) {
  const order = await VideoOrder.findOne({ reference }).session(session).lean()
  if (!order) return null
  if (order.status === 'success') return { order, newlySettled: false }
  const update = (set) => VideoOrder.findOneAndUpdate({ _id: order._id, status: { $ne: 'success' } }, { $set: set }, { returnDocument: 'after', session }).lean()

  if (gatewayData.status !== 'success') {
    const failed = await update({ status: gatewayData.status === 'abandoned' ? 'cancelled' : 'failed', gateway_response: gatewayData })
    return { order: failed ?? order, newlySettled: false }
  }
  if (Number(gatewayData.amount) !== Number(order.amount_kobo) || gatewayData.currency !== 'NGN') {
    const flagged = await update({ status: 'failed', gateway_response: gatewayData, notes: 'Amount/currency mismatch — review manually' })
    return { order: flagged ?? order, newlySettled: false }
  }
  const settled = await update({
    status: 'success',
    paid_at: gatewayData.paid_at ? new Date(gatewayData.paid_at) : new Date(),
    channel: gatewayData.channel ?? 'card',
    gateway_response: gatewayData,
  })
  if (!settled) return { order: await VideoOrder.findById(order._id).session(session).lean(), newlySettled: false }
  const course = await VideoCourse.findById(order.course_id).session(session).lean()
  await grantAccess({ userId: order.user_id, course, source: 'purchase', orderId: order._id }, session)
  return { order: settled, newlySettled: true }
}

export async function emailVideoReceipt(orderId) {
  const order = await VideoOrder.findById(orderId).lean()
  if (!order) return
  const [user, course] = await Promise.all([User.findById(order.user_id, 'email full_name').lean(), VideoCourse.findById(order.course_id, 'title slug').lean()])
  if (!user || !course) return
  const amount = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(order.amount_kobo / 100)
  await sendMail({
    to: user.email,
    subject: `You now have access to ${course.title}`,
    html: layout({
      heading: `Thank you, ${(user.full_name || 'there').split(' ')[0]}`,
      paragraphs: [
        `We received your payment of ${amount} for the online course "${course.title}" (reference ${order.reference}).`,
        'You can start watching straight away. Videos play on the website only; please keep your login to yourself, as an account can watch on one device at a time.',
      ],
      action: { label: 'Start watching', url: `${config.webUrl}/portal/videos/${course.slug}` },
    }),
  })
}
