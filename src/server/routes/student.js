// Student portal API (spec §8). Every query is scoped to req.student — a student only ever sees their own data.
import { z } from 'zod'
import {
  Announcement, Result, Course, Programme, Cohort, TimetableEntry, Assignment, Submission, Attendance, Student, User,
  Invoice, Payment, DocumentVerification, Material, File, Certificate, StudentRequest, Feedback, Application,
} from '../db/models.js'
import { withTransaction } from '../db/mongo.js'
import { config } from '../config.js'
import { parse, idParam, optionalText, requiredText, phone, id } from '../lib/validate.js'
import { resolveUpload, sendFile, deleteFile, getFileBuffer } from '../lib/storage.js'
import { randomToken, verificationCode } from '../lib/security.js'
import { getSettings } from '../lib/settings.js'
import { accountSummary, instalmentSchedule, settleGatewayPayment, emailReceipt, studentForReceipt } from '../lib/finance.js'
import { initializeTransaction, verifyTransaction, paystackEnabled } from '../lib/paystack.js'
import { studentResultSheet } from '../lib/results.js'
import { receiptPdf, resultSlipPdf, certificatePdf, idCardPdf } from '../lib/pdf.js'
import { requireStudent } from '../middleware/auth.js'
import { Router, badRequest, notFoundError, defer } from '../http.js'

export const student = new Router()
student.use(requireStudent)

const sendPdf = (res, filename, buffer, inline = false) => {
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`)
  res.send(buffer)
}

/** Map of course id → name for a set of ids. */
async function courseNames(ids) {
  const list = await Course.find({ _id: { $in: ids.filter(Boolean) } }, 'name').lean()
  return new Map(list.map((c) => [String(c._id), c.name]))
}

// Announcements visible to this student: everyone, their programme, or their cohort.
const announcementsFor = (s, limit = 50) =>
  Announcement.find({
    $and: [
      { $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }] },
      { $or: [{ audience: 'all' }, { audience: 'programme', programme_id: s.programme_id }, { audience: 'cohort', cohort_id: s.cohort_id }] },
    ],
  }, 'title body is_pinned created_at').sort({ is_pinned: -1, created_at: -1 }).limit(limit).lean()

// ── Dashboard ────────────────────────────────────────────────────────────────

student.get('/dashboard', async (req, res) => {
  const s = req.student
  const [account, notices, latest, timetable, pendingAssignments, attendance] = await Promise.all([
    accountSummary(s._id),
    announcementsFor(s, 5),
    Result.findOne({ student_id: s._id, status: 'published' }).sort({ published_at: -1 }).lean(),
    s.cohort_id ? TimetableEntry.find({ cohort_id: s.cohort_id }).sort({ day_of_week: 1, start_time: 1 }).lean() : [],
    pendingAssignmentCount(s),
    attendanceSummary(s),
  ])
  const names = await courseNames([latest?.course_id, ...timetable.map((t) => t.course_id)])

  const { results } = await getSettings()
  const withheld = results.withholdIfOwing && account.balanceKobo > 0

  let currentWeek = null
  if (s.cohort_starts_on) {
    const days = Math.floor((Date.now() - new Date(`${s.cohort_starts_on}T00:00:00+01:00`).getTime()) / 86_400_000)
    if (days >= 0) currentWeek = Math.floor(days / 7) + 1
  }

  res.json({
    student: studentProfile(s),
    currentWeek,
    account,
    latestResult: withheld || !latest ? null : { course_name: names.get(String(latest.course_id)), total: latest.total, grade: latest.grade, published_at: latest.published_at },
    resultsWithheld: withheld,
    nextClass: nextClass(timetable.map((t) => ({ ...t, course_name: names.get(String(t.course_id)) ?? null }))),
    notices,
    pendingAssignments,
    attendance,
  })
})

async function pendingAssignmentCount(s) {
  if (!s.cohort_id) return 0
  const open = await Assignment.find({ cohort_id: s.cohort_id, $or: [{ due_at: null }, { due_at: { $gt: new Date() } }] }, '_id').lean()
  if (!open.length) return 0
  const done = await Submission.countDocuments({ student_id: s._id, assignment_id: { $in: open.map((a) => a._id) } })
  return open.length - done
}

// Finds the next timetable slot after "now" in Lagos time.
function nextClass(entries) {
  if (!entries.length) return null
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  const today = ((now.getDay() + 6) % 7) + 1 // 1 = Monday
  const hhmm = now.toTimeString().slice(0, 5)
  const ordered = [...entries].sort((a, b) => {
    const da = (a.day_of_week - today + 7) % 7 || (a.start_time > hhmm ? 0 : 7)
    const db = (b.day_of_week - today + 7) % 7 || (b.start_time > hhmm ? 0 : 7)
    return da - db || a.start_time.localeCompare(b.start_time)
  })
  const e = ordered[0]
  return { title: e.title, courseName: e.course_name, dayOfWeek: e.day_of_week, startTime: e.start_time, endTime: e.end_time, venue: e.venue, instructor: e.instructor }
}

async function attendanceSummary(s) {
  if (!s.cohort_id) return null
  const rows = await Attendance.find({ student_id: s._id, cohort_id: s.cohort_id }, 'status').lean()
  const attended = rows.filter((r) => r.status === 'present' || r.status === 'late').length
  const absent = rows.filter((r) => r.status === 'absent').length
  return { total: rows.length, attended, absent, rate: rows.length ? Math.round((attended / rows.length) * 100) : null }
}

function studentProfile(s) {
  return {
    id: String(s._id),
    studentNumber: s.student_number,
    firstName: s.first_name,
    lastName: s.last_name,
    email: s.email,
    phone: s.phone,
    gender: s.gender,
    dateOfBirth: s.date_of_birth,
    address: s.address,
    city: s.city,
    state: s.state,
    guardianName: s.guardian_name,
    guardianPhone: s.guardian_phone,
    guardianRelationship: s.guardian_relationship,
    sponsor: s.sponsor ?? s.cohort_sponsor,
    status: s.status,
    hasPhoto: Boolean(s.photo_file_id),
    programme: s.programme_name,
    programmeSlug: s.programme_slug,
    cohort: s.cohort_name,
    cohortStartsOn: s.cohort_starts_on,
    cohortEndsOn: s.cohort_ends_on,
    schedule: s.cohort_schedule,
    enrolledOn: s.enrolled_on,
  }
}

// ── Profile ──────────────────────────────────────────────────────────────────

student.get('/profile', (req, res) => res.json(studentProfile(req.student)))

const profileSchema = z.object({
  phone: phone.optional(),
  address: optionalText(300),
  city: optionalText(100),
  state: optionalText(100),
  guardianName: optionalText(120),
  guardianPhone: optionalText(30),
  guardianRelationship: optionalText(60),
})

// Contact details only. Name, programme and other official fields change via a "change of details" request.
student.patch('/profile', async (req, res) => {
  const b = parse(profileSchema, req.body)
  const set = {
    address: b.address, city: b.city, state: b.state,
    guardian_name: b.guardianName, guardian_phone: b.guardianPhone, guardian_relationship: b.guardianRelationship,
  }
  if (b.phone) set.phone = b.phone
  const s = await Student.findByIdAndUpdate(req.student._id, { $set: set }, { returnDocument: 'after' }).lean()
  if (b.phone) await User.updateOne({ _id: req.user._id }, { $set: { phone: b.phone } })
  res.json(studentProfile({ ...req.student, ...s }))
})

// Profile photo: JSON { fileId } from a direct upload, or a small multipart `file`.
student.post('/profile/photo', async (req, res) => {
  const f = await resolveUpload(req, { purpose: 'profile_photo' })
  if (!f) throw badRequest('Please attach a photo')
  const old = req.student.photo_file_id
  await Student.updateOne({ _id: req.student._id }, { $set: { photo_file_id: f._id } })
  if (old && !(await isApplicationDocument(old))) await deleteFile(old)
  res.status(201).json({ ok: true })
})

// The enrolment photo also belongs to the application, so it's kept when replaced.
const isApplicationDocument = async (fileId) => Boolean(await Application.exists({ 'documents.file_id': fileId }))

student.get('/profile/photo', async (req, res) => {
  if (!req.student.photo_file_id) throw notFoundError('No photo')
  await sendFile(res, req.student.photo_file_id)
})

student.get('/id-card.pdf', async (req, res) => {
  const photo = req.student.photo_file_id ? await getFileBuffer(req.student.photo_file_id) : null
  sendPdf(res, `id-card-${req.student.student_number.replace(/\//g, '-')}.pdf`, await idCardPdf({ student: req.student, photo }))
})

// ── Results ──────────────────────────────────────────────────────────────────

async function resultsAccess(s) {
  const { results } = await getSettings()
  if (results.withholdIfOwing) {
    const { balanceKobo } = await accountSummary(s._id)
    if (balanceKobo > 0) return { withheld: true, balanceKobo, showPositions: results.showPositions }
  }
  return { withheld: false, showPositions: results.showPositions }
}

// Cohorts this student has results in (a student may have moved cohort), current cohort first.
async function studentCohorts(s) {
  const ids = await Result.distinct('cohort_id', { student_id: s._id, status: 'published' })
  if (s.cohort_id) ids.push(s.cohort_id)
  const cohorts = await Cohort.find({ _id: { $in: ids } }).lean()
  const programmes = new Map((await Programme.find({ _id: { $in: cohorts.map((c) => c.programme_id) } }, 'name').lean()).map((p) => [String(p._id), p.name]))
  return cohorts
    .map((c) => ({ id: String(c._id), name: c.name, programme_name: programmes.get(String(c.programme_id)), starts_on: c.starts_on }))
    .sort((a, b) => (b.starts_on ?? '').localeCompare(a.starts_on ?? ''))
}

student.get('/results', async (req, res) => {
  const access = await resultsAccess(req.student)
  if (access.withheld) return res.json({ withheld: true, balanceKobo: access.balanceKobo, terms: [] })
  const cohorts = await studentCohorts(req.student)
  const terms = []
  for (const c of cohorts) {
    const sheet = await studentResultSheet({ studentId: req.student._id, cohortId: c.id, showPositions: access.showPositions })
    terms.push({ cohortId: c.id, cohort: c.name, programme: c.programme_name, ...sheet })
  }
  res.json({ withheld: false, terms, scheme: terms[0]?.scheme ?? null })
})

student.get('/results/:cohortId/slip.pdf', async (req, res) => {
  const cohortId = idParam(req, 'cohortId')
  const access = await resultsAccess(req.student)
  if (access.withheld) throw badRequest('Your results are withheld until outstanding fees are paid.')
  const cohort = await Cohort.findById(cohortId).lean()
  if (!cohort) throw notFoundError()
  cohort.programme_name = (await Programme.findById(cohort.programme_id, 'name').lean())?.name
  const sheet = await studentResultSheet({ studentId: req.student._id, cohortId, showPositions: access.showPositions })
  if (!sheet.rows.length) throw notFoundError('No published results for this cohort yet')

  // Reuse the code while results are unchanged, so reprints verify against the same record.
  const snapshot = {
    programme: cohort.programme_name,
    cohort: cohort.name,
    rows: sheet.rows.map((r) => ({ course: r.course_name, total: r.total, grade: r.grade })),
    summary: sheet.summary,
  }
  const snapshotKey = JSON.stringify(snapshot)
  const existing = await DocumentVerification.findOne({ kind: 'result_slip', student_id: req.student._id, cohort_id: cohortId, snapshot_key: snapshotKey }).lean()
  const code = existing?.code ?? `RS-${verificationCode(8)}`
  if (!existing) {
    await DocumentVerification.create({ code, kind: 'result_slip', student_id: req.student._id, cohort_id: cohortId, snapshot, snapshot_key: snapshotKey })
  }
  const pdf = await resultSlipPdf({ student: req.student, cohort, rows: sheet.rows, summary: sheet.summary, verificationCode: code, scheme: sheet.scheme })
  sendPdf(res, `result-slip-${req.student.student_number.replace(/\//g, '-')}.pdf`, pdf)
})

// ── Payments (spec §8.4, §10) ────────────────────────────────────────────────

student.get('/payments', async (req, res) => {
  const sid = req.student._id
  const [account, schedule, invoices, payments] = await Promise.all([
    accountSummary(sid),
    instalmentSchedule(sid),
    Invoice.find({ student_id: sid, voided_at: null }, 'description category kind amount_kobo due_date created_at').sort({ created_at: 1 }).lean(),
    Payment.find({ student_id: sid, status: { $in: ['success', 'refunded', 'pending'] } },
      'amount_kobo purpose method reference receipt_number status paid_at created_at').lean(),
  ])
  payments.sort((a, b) => new Date(b.paid_at ?? b.created_at) - new Date(a.paid_at ?? a.created_at))
  res.json({ account, schedule, invoices, payments, onlinePayments: paystackEnabled() })
})

const initSchema = z.object({ amountKobo: z.coerce.number().int().min(10_000, 'Minimum online payment is ₦100'), invoiceId: id.optional() })

student.post('/payments/initialize', async (req, res) => {
  const { amountKobo, invoiceId } = parse(initSchema, req.body)
  const { balanceKobo } = await accountSummary(req.student._id)
  if (balanceKobo <= 0) throw badRequest('You have no outstanding balance')
  if (amountKobo > balanceKobo) throw badRequest('Amount is more than your outstanding balance', { amountKobo: 'Too high' })
  let purpose = 'School fees'
  if (invoiceId) {
    const inv = await Invoice.findOne({ _id: invoiceId, student_id: req.student._id, voided_at: null }, 'description').lean()
    if (!inv) throw notFoundError('Invoice not found')
    purpose = inv.description
  }
  const reference = `CCA-${Date.now().toString(36).toUpperCase()}-${randomToken(4).toUpperCase().replace(/[^A-Z0-9]/g, '')}`
  const payment = await Payment.create({
    student_id: req.student._id, invoice_id: invoiceId ?? null, amount_kobo: amountKobo, purpose, method: 'card', reference, status: 'pending', gateway: 'paystack',
  })
  try {
    const init = await initializeTransaction({
      email: req.user.email,
      amountKobo,
      reference,
      callbackUrl: `${config.webUrl}/portal/payments?reference=${reference}`,
      metadata: { student_id: String(req.student._id), student_number: req.student.student_number, payment_id: String(payment._id), purpose },
    })
    res.json({ authorizationUrl: init.authorization_url, reference })
  } catch (err) {
    await Payment.updateOne({ _id: payment._id }, { $set: { status: 'failed', notes: err.message } })
    throw err
  }
})

// Called when Paystack redirects back. The webhook settles the same payment if this never runs.
student.get('/payments/verify/:reference', async (req, res) => {
  const reference = String(req.params.reference)
  const mine = await Payment.exists({ reference, student_id: req.student._id })
  if (!mine) throw notFoundError('Payment not found')
  const data = await verifyTransaction(reference)
  const result = await withTransaction((session) => settleGatewayPayment(session, reference, data))
  if (result?.newlySettled) defer(() => emailReceipt(result.payment._id))
  res.json({ status: result.payment.status, receiptNumber: result.payment.receipt_number, amountKobo: result.payment.amount_kobo })
})

student.get('/payments/:id/receipt.pdf', async (req, res) => {
  const payment = await Payment.findOne({ _id: idParam(req), student_id: req.student._id, status: 'success' }).lean()
  if (!payment) throw notFoundError('Receipt not found')
  const s = await studentForReceipt(req.student._id)
  const { balanceKobo } = await accountSummary(req.student._id)
  sendPdf(res, `${payment.receipt_number}.pdf`, await receiptPdf({ payment, student: { ...s, balance_kobo: balanceKobo } }))
})

// ── Timetable, attendance, notices ───────────────────────────────────────────

student.get('/timetable', async (req, res) => {
  const s = req.student
  const rows = s.cohort_id ? await TimetableEntry.find({ cohort_id: s.cohort_id }).sort({ day_of_week: 1, start_time: 1 }).lean() : []
  const names = await courseNames(rows.map((r) => r.course_id))
  res.json({
    cohort: s.cohort_name, schedule: s.cohort_schedule, startsOn: s.cohort_starts_on, endsOn: s.cohort_ends_on,
    entries: rows.map((t) => ({
      id: String(t._id), day_of_week: t.day_of_week, start_time: t.start_time, end_time: t.end_time, title: t.title,
      instructor: t.instructor, venue: t.venue, course_name: names.get(String(t.course_id)) ?? null,
    })),
  })
})

student.get('/attendance', async (req, res) => {
  const s = req.student
  const records = s.cohort_id ? await Attendance.find({ student_id: s._id, cohort_id: s.cohort_id }, 'date status -_id').sort({ date: -1 }).lean() : []
  res.json({ summary: await attendanceSummary(s), records })
})

student.get('/announcements', async (req, res) => res.json(await announcementsFor(req.student)))

// ── Course outline (programme outline + each course in the programme) ────────

async function outlineInfo(fileIds) {
  const files = await File.find({ _id: { $in: fileIds.filter(Boolean) }, status: 'ready' }, 'filename size_bytes').lean()
  return new Map(files.map((f) => [String(f._id), { filename: f.filename, size: f.size_bytes }]))
}

student.get('/course-outline', async (req, res) => {
  const pid = req.student.programme_id
  if (!pid) return res.json({ programme: null, courses: [] })
  const p = await Programme.findById(pid).lean()
  const courses = await Course.find({ _id: { $in: p.course_ids } }).lean()
  const byId = new Map(courses.map((c) => [String(c._id), c]))
  const ordered = p.course_ids.map((cid) => byId.get(String(cid))).filter(Boolean)
  const outlines = await outlineInfo([p.outline_file_id, ...ordered.map((c) => c.outline_file_id)])
  res.json({
    programme: {
      id: String(p._id), name: p.name, summary: p.summary, curriculum: p.curriculum, duration_weeks: p.duration_weeks, schedule: p.schedule,
      outline: outlines.get(String(p.outline_file_id)) ?? null,
    },
    courses: ordered.map((c) => ({ id: String(c._id), name: c.name, type: c.type, description: c.description, outline: outlines.get(String(c.outline_file_id)) ?? null })),
  })
})

student.get('/course-outline/programme/download', async (req, res) => {
  const p = await Programme.findById(req.student.programme_id, 'outline_file_id').lean()
  if (!p?.outline_file_id) throw notFoundError('No programme outline uploaded yet')
  await sendFile(res, p.outline_file_id, { inline: false })
})

student.get('/course-outline/courses/:id/download', async (req, res) => {
  // Only courses that belong to the student's programme.
  const courseId = idParam(req)
  const inProgramme = await Programme.exists({ _id: req.student.programme_id, course_ids: courseId })
  const c = inProgramme ? await Course.findById(courseId, 'outline_file_id').lean() : null
  if (!c?.outline_file_id) throw notFoundError('No outline uploaded for this course yet')
  await sendFile(res, c.outline_file_id, { inline: false })
})

// ── Learning materials & assignments (spec §8.5) ─────────────────────────────

// Published materials for this student's cohort, their programme, or everyone.
const materialsFilter = (s) => ({
  is_published: true,
  $or: [
    ...(s.cohort_id ? [{ cohort_id: s.cohort_id }] : []),
    ...(s.programme_id ? [{ cohort_id: null, programme_id: s.programme_id }] : []),
    { cohort_id: null, programme_id: null },
  ],
})

student.get('/materials', async (req, res) => {
  const rows = await Material.find(materialsFilter(req.student)).sort({ created_at: -1 }).lean()
  const [names, files] = await Promise.all([
    courseNames(rows.map((m) => m.course_id)),
    File.find({ _id: { $in: rows.map((m) => m.file_id).filter(Boolean) } }, 'filename mime_type size_bytes').lean(),
  ])
  const fileById = new Map(files.map((f) => [String(f._id), f]))
  const out = rows.map((m) => {
    const f = fileById.get(String(m.file_id))
    return {
      id: String(m._id), title: m.title, description: m.description, url: m.url, created_at: m.created_at,
      course_name: names.get(String(m.course_id)) ?? null, filename: f?.filename ?? null, mime_type: f?.mime_type ?? null, size_bytes: f?.size_bytes ?? null,
    }
  })
  out.sort((a, b) => (a.course_name ?? '￿').localeCompare(b.course_name ?? '￿'))
  res.json(out)
})

student.get('/materials/:id/download', async (req, res) => {
  const m = await Material.findOne({ _id: idParam(req), file_id: { $ne: null }, ...materialsFilter(req.student) }, 'file_id').lean()
  if (!m) throw notFoundError('Material not found')
  await sendFile(res, m.file_id, { inline: false })
})

student.get('/assignments', async (req, res) => {
  const s = req.student
  if (!s.cohort_id) return res.json([])
  const list = await Assignment.find({ cohort_id: s.cohort_id }).lean()
  const subs = await Submission.find({ student_id: s._id, assignment_id: { $in: list.map((a) => a._id) } }).lean()
  const subBy = new Map(subs.map((x) => [String(x.assignment_id), x]))
  const [names, files] = await Promise.all([
    courseNames(list.map((a) => a.course_id)),
    File.find({ _id: { $in: subs.map((x) => x.file_id).filter(Boolean) } }, 'filename').lean(),
  ])
  const fileName = new Map(files.map((f) => [String(f._id), f.filename]))
  const rows = list.map((a) => {
    const x = subBy.get(String(a._id))
    return {
      id: String(a._id), title: a.title, description: a.description, due_at: a.due_at, created_at: a.created_at,
      course_name: names.get(String(a.course_id)) ?? null,
      submission_id: x ? String(x._id) : null, submitted_at: x?.submitted_at ?? null, note: x?.note ?? null, feedback: x?.feedback ?? null,
      score: x?.score ?? null, reviewed_at: x?.reviewed_at ?? null, filename: x?.file_id ? fileName.get(String(x.file_id)) ?? null : null,
    }
  })
  rows.sort((a, b) => (a.due_at ? +new Date(a.due_at) : Infinity) - (b.due_at ? +new Date(b.due_at) : Infinity) || new Date(b.created_at) - new Date(a.created_at))
  res.json(rows)
})

// Submission: JSON { note, fileId } from a direct upload, or multipart `note` + small `file`.
student.post('/assignments/:id/submit', async (req, res) => {
  const assignmentId = idParam(req)
  const { note } = parse(z.object({ note: optionalText(3000) }), req.body)
  const a = await Assignment.findOne({ _id: assignmentId, cohort_id: req.student.cohort_id }).lean()
  if (!a) throw notFoundError('Assignment not found')
  if (a.due_at && new Date(a.due_at) < new Date()) throw badRequest('The deadline for this assignment has passed')
  const existing = await Submission.findOne({ assignment_id: assignmentId, student_id: req.student._id }).lean()
  if (existing?.reviewed_at) throw badRequest('This submission has already been marked')
  const f = await resolveUpload(req, { purpose: 'submission' })
  if (!f && !note) throw badRequest('Attach a file or write a note')

  await Submission.updateOne(
    { assignment_id: assignmentId, student_id: req.student._id },
    { $set: { note, submitted_at: new Date(), ...(f ? { file_id: f._id } : {}) } },
    { upsert: true },
  )
  if (f && existing?.file_id) await deleteFile(existing.file_id)
  res.status(201).json({ ok: true })
})

student.get('/submissions/:id/file', async (req, res) => {
  const s = await Submission.findOne({ _id: idParam(req), student_id: req.student._id }, 'file_id').lean()
  if (!s?.file_id) throw notFoundError()
  await sendFile(res, s.file_id, { inline: false })
})

// ── Certificates ─────────────────────────────────────────────────────────────

student.get('/certificates', async (req, res) => {
  res.json(await Certificate.find({ student_id: req.student._id, revoked_at: null }, 'title grade issued_on serial verification_code').sort({ issued_on: -1 }).lean())
})

student.get('/certificates/:id/pdf', async (req, res) => {
  const cert = await Certificate.findOne({ _id: idParam(req), student_id: req.student._id, revoked_at: null }).lean()
  if (!cert) throw notFoundError('Certificate not found')
  sendPdf(res, `certificate-${cert.serial}.pdf`, await certificatePdf({ certificate: cert, student: req.student }))
})

// ── Requests & feedback ──────────────────────────────────────────────────────

student.get('/requests', async (req, res) => {
  res.json(await StudentRequest.find({ student_id: req.student._id }, 'type details status response created_at updated_at').sort({ created_at: -1 }).lean())
})

student.post('/requests', async (req, res) => {
  const b = parse(z.object({ type: z.enum(['transcript', 'recommendation', 'change_of_details', 'other']), details: requiredText(3000) }), req.body)
  const open = await StudentRequest.countDocuments({ student_id: req.student._id, status: { $in: ['open', 'in_progress'] } })
  if (open >= 10) throw badRequest('You have too many open requests. Please wait for the academy to respond.')
  const row = await StudentRequest.create({ student_id: req.student._id, type: b.type, details: b.details })
  res.status(201).json(row)
})

student.get('/feedback', async (req, res) => {
  const p = req.student.programme_id ? await Programme.findById(req.student.programme_id, 'course_ids').lean() : null
  const [courseList, given] = await Promise.all([
    p ? Course.find({ _id: { $in: p.course_ids } }, 'name').lean() : [],
    Feedback.find({ student_id: req.student._id }).sort({ created_at: -1 }).lean(),
  ])
  const order = new Map((p?.course_ids ?? []).map((cid, i) => [String(cid), i]))
  courseList.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)))
  const names = new Map(courseList.map((c) => [String(c._id), c.name]))
  res.json({
    courses: courseList.map((c) => ({ id: String(c._id), name: c.name })),
    given: given.map((f) => ({ id: String(f._id), rating: f.rating, comments: f.comments, created_at: f.created_at, course_name: names.get(String(f.course_id)) ?? null })),
  })
})

student.post('/feedback', async (req, res) => {
  const b = parse(z.object({ courseId: id.optional().nullable(), rating: z.coerce.number().int().min(1).max(5), comments: optionalText(3000) }), req.body)
  const row = await Feedback.create({ student_id: req.student._id, cohort_id: req.student.cohort_id, course_id: b.courseId ?? null, rating: b.rating, comments: b.comments })
  res.status(201).json({ id: row._id })
})
