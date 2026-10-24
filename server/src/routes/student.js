// Student portal API (spec §8). Every query is scoped to req.student — a student only ever sees their own data.
import { Router } from 'express'
import { z } from 'zod'
import { one, many, query, tx, db } from '../db/pool.js'
import { config } from '../config.js'
import { parse, idParam, optionalText, requiredText, phone, id } from '../lib/validate.js'
import { upload, storeFile, sendFile, IMAGE_TYPES, MATERIAL_TYPES } from '../lib/files.js'
import { randomToken, verificationCode } from '../lib/security.js'
import { getSettings } from '../lib/settings.js'
import { accountSummary, instalmentSchedule, settleGatewayPayment, emailReceipt, studentForReceipt } from '../lib/finance.js'
import { initializeTransaction, verifyTransaction, paystackEnabled } from '../lib/paystack.js'
import { studentResultSheet } from '../lib/results.js'
import { receiptPdf, resultSlipPdf, certificatePdf, idCardPdf } from '../lib/pdf.js'
import { requireStudent } from '../middleware/auth.js'
import { HttpError, badRequest, notFoundError } from '../middleware/errors.js'

export const student = Router()
student.use(requireStudent)

const sendPdf = (res, filename, buffer, inline = false) => {
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`)
  res.send(buffer)
}

// Announcements visible to this student: everyone, their programme, or their cohort.
const announcementsFor = (s, limit = 50) =>
  many(
    `SELECT id, title, body, is_pinned, created_at FROM announcements
      WHERE (expires_at IS NULL OR expires_at > now())
        AND (audience = 'all' OR (audience = 'programme' AND programme_id = $1) OR (audience = 'cohort' AND cohort_id = $2))
      ORDER BY is_pinned DESC, created_at DESC LIMIT $3`,
    [s.programme_id, s.cohort_id, limit],
  )

// ── Dashboard ────────────────────────────────────────────────────────────────

student.get('/dashboard', async (req, res) => {
  const s = req.student
  const [account, notices, latest, timetable, pendingAssignments, attendance] = await Promise.all([
    accountSummary(db, s.id),
    announcementsFor(s, 5),
    one(
      `SELECT c.name AS course_name, r.total, r.grade, r.published_at FROM results r JOIN courses c ON c.id = r.course_id
        WHERE r.student_id = $1 AND r.status = 'published' ORDER BY r.published_at DESC LIMIT 1`,
      [s.id],
    ),
    s.cohort_id
      ? many(
          `SELECT t.*, c.name AS course_name FROM timetable_entries t LEFT JOIN courses c ON c.id = t.course_id
            WHERE t.cohort_id = $1 ORDER BY day_of_week, start_time`,
          [s.cohort_id],
        )
      : [],
    s.cohort_id
      ? one(
          `SELECT COUNT(*)::int AS n FROM assignments a
            WHERE a.cohort_id = $1 AND (a.due_at IS NULL OR a.due_at > now())
              AND NOT EXISTS (SELECT 1 FROM submissions x WHERE x.assignment_id = a.id AND x.student_id = $2)`,
          [s.cohort_id, s.id],
        )
      : { n: 0 },
    attendanceSummary(s),
  ])

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
    latestResult: withheld ? null : latest,
    resultsWithheld: withheld,
    nextClass: nextClass(timetable),
    notices,
    pendingAssignments: pendingAssignments.n,
    attendance,
  })
})

// Finds the next timetable slot after "now" in Lagos time.
function nextClass(entries) {
  if (!entries.length) return null
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  const today = ((now.getDay() + 6) % 7) + 1 // 1 = Monday
  const hhmm = now.toTimeString().slice(0, 5)
  const ordered = [...entries].sort((a, b) => {
    const da = (a.day_of_week - today + 7) % 7 || (a.start_time.slice(0, 5) > hhmm ? 0 : 7)
    const dbb = (b.day_of_week - today + 7) % 7 || (b.start_time.slice(0, 5) > hhmm ? 0 : 7)
    return da - dbb || a.start_time.localeCompare(b.start_time)
  })
  const e = ordered[0]
  return { title: e.title, courseName: e.course_name, dayOfWeek: e.day_of_week, startTime: e.start_time.slice(0, 5), endTime: e.end_time.slice(0, 5), venue: e.venue, instructor: e.instructor }
}

async function attendanceSummary(s) {
  if (!s.cohort_id) return null
  const r = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('present', 'late'))::int AS attended,
            COUNT(*) FILTER (WHERE status = 'absent')::int AS absent
       FROM attendance WHERE student_id = $1 AND cohort_id = $2`,
    [s.id, s.cohort_id],
  )
  return { ...r, rate: r.total ? Math.round((r.attended / r.total) * 100) : null }
}

function studentProfile(s) {
  return {
    id: s.id,
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
  await tx(async (t) => {
    await t.query(
      `UPDATE students SET phone = COALESCE($2, phone), address = $3, city = $4, state = $5,
              guardian_name = $6, guardian_phone = $7, guardian_relationship = $8, updated_at = now()
        WHERE id = $1`,
      [req.student.id, b.phone ?? null, b.address, b.city, b.state, b.guardianName, b.guardianPhone, b.guardianRelationship],
    )
    if (b.phone) await t.query('UPDATE users SET phone = $2 WHERE id = $1', [req.user.id, b.phone])
  })
  const s = await one('SELECT * FROM students WHERE id = $1', [req.student.id])
  res.json(studentProfile({ ...req.student, ...s }))
})

student.post('/profile/photo', upload.single('file'), async (req, res) => {
  const old = req.student.photo_file_id
  await tx(async (t) => {
    const f = await storeFile(t, req.file, req.user.id, IMAGE_TYPES)
    await t.query('UPDATE students SET photo_file_id = $2, updated_at = now() WHERE id = $1', [req.student.id, f.id])
    if (old) await t.query('DELETE FROM files WHERE id = $1', [old])
  })
  res.status(201).json({ ok: true })
})

student.get('/profile/photo', async (req, res) => {
  if (!req.student.photo_file_id) throw notFoundError('No photo')
  await sendFile(res, db, req.student.photo_file_id)
})

student.get('/id-card.pdf', async (req, res) => {
  const photo = req.student.photo_file_id ? (await one('SELECT data FROM files WHERE id = $1', [req.student.photo_file_id]))?.data : null
  sendPdf(res, `id-card-${req.student.student_number.replace(/\//g, '-')}.pdf`, await idCardPdf({ student: req.student, photo }))
})

// ── Results ──────────────────────────────────────────────────────────────────

async function resultsAccess(s) {
  const { results } = await getSettings()
  if (results.withholdIfOwing) {
    const { balanceKobo } = await accountSummary(db, s.id)
    if (balanceKobo > 0) return { withheld: true, balanceKobo, showPositions: results.showPositions }
  }
  return { withheld: false, showPositions: results.showPositions }
}

// Cohorts this student has results in (a student may have moved cohort), current cohort first.
const studentCohorts = (s) =>
  many(
    `SELECT DISTINCT c.id, c.name, p.name AS programme_name, c.starts_on
       FROM cohorts c JOIN programmes p ON p.id = c.programme_id
      WHERE c.id = $2 OR c.id IN (SELECT cohort_id FROM results WHERE student_id = $1 AND status = 'published')
      ORDER BY c.starts_on DESC NULLS LAST`,
    [s.id, s.cohort_id],
  )

student.get('/results', async (req, res) => {
  const access = await resultsAccess(req.student)
  if (access.withheld) return res.json({ withheld: true, balanceKobo: access.balanceKobo, terms: [] })
  const cohorts = await studentCohorts(req.student)
  const terms = []
  for (const c of cohorts) {
    const sheet = await studentResultSheet(db, { studentId: req.student.id, cohortId: c.id, showPositions: access.showPositions })
    terms.push({ cohortId: c.id, cohort: c.name, programme: c.programme_name, ...sheet })
  }
  res.json({ withheld: false, terms, scheme: terms[0]?.scheme ?? null })
})

student.get('/results/:cohortId/slip.pdf', async (req, res) => {
  const cohortId = idParam(req, 'cohortId')
  const access = await resultsAccess(req.student)
  if (access.withheld) throw new HttpError(403, 'Your results are withheld until outstanding fees are paid.')
  const cohort = await one('SELECT c.*, p.name AS programme_name FROM cohorts c JOIN programmes p ON p.id = c.programme_id WHERE c.id = $1', [cohortId])
  if (!cohort) throw notFoundError()
  const sheet = await studentResultSheet(db, { studentId: req.student.id, cohortId, showPositions: access.showPositions })
  if (!sheet.rows.length) throw notFoundError('No published results for this cohort yet')

  // Reuse the code while results are unchanged, so reprints verify against the same record.
  const snapshot = {
    programme: cohort.programme_name,
    cohort: cohort.name,
    rows: sheet.rows.map((r) => ({ course: r.course_name, total: r.total, grade: r.grade })),
    summary: sheet.summary,
  }
  const existing = await one(
    `SELECT code FROM document_verifications WHERE kind = 'result_slip' AND student_id = $1 AND cohort_id = $2 AND snapshot = $3::jsonb`,
    [req.student.id, cohortId, JSON.stringify(snapshot)],
  )
  const code = existing?.code ?? `RS-${verificationCode(8)}`
  if (!existing) {
    await query(`INSERT INTO document_verifications (code, kind, student_id, cohort_id, snapshot) VALUES ($1, 'result_slip', $2, $3, $4)`, [code, req.student.id, cohortId, snapshot])
  }
  const pdf = await resultSlipPdf({ student: req.student, cohort, rows: sheet.rows, summary: sheet.summary, verificationCode: code, scheme: sheet.scheme })
  sendPdf(res, `result-slip-${req.student.student_number.replace(/\//g, '-')}.pdf`, pdf)
})

// ── Payments (spec §8.4, §10) ────────────────────────────────────────────────

student.get('/payments', async (req, res) => {
  const [account, schedule, invoices, payments] = await Promise.all([
    accountSummary(db, req.student.id),
    instalmentSchedule(db, req.student.id),
    many(`SELECT id, description, category, kind, amount_kobo, due_date, created_at FROM invoices WHERE student_id = $1 AND voided_at IS NULL ORDER BY created_at`, [req.student.id]),
    many(
      `SELECT id, amount_kobo, purpose, method, reference, receipt_number, status, paid_at, created_at
         FROM payments WHERE student_id = $1 AND status IN ('success', 'refunded', 'pending')
        ORDER BY COALESCE(paid_at, created_at) DESC`,
      [req.student.id],
    ),
  ])
  res.json({ account, schedule, invoices, payments, onlinePayments: paystackEnabled() })
})

const initSchema = z.object({ amountKobo: z.coerce.number().int().min(10_000, 'Minimum online payment is ₦100'), invoiceId: id.optional() })

student.post('/payments/initialize', async (req, res) => {
  const { amountKobo, invoiceId } = parse(initSchema, req.body)
  const { balanceKobo } = await accountSummary(db, req.student.id)
  if (balanceKobo <= 0) throw badRequest('You have no outstanding balance')
  if (amountKobo > balanceKobo) throw badRequest('Amount is more than your outstanding balance', { amountKobo: 'Too high' })
  let purpose = 'School fees'
  if (invoiceId) {
    const inv = await one('SELECT description FROM invoices WHERE id = $1 AND student_id = $2 AND voided_at IS NULL', [invoiceId, req.student.id])
    if (!inv) throw notFoundError('Invoice not found')
    purpose = inv.description
  }
  const reference = `CCA-${Date.now().toString(36).toUpperCase()}-${randomToken(4).toUpperCase().replace(/[^A-Z0-9]/g, '')}`
  const email = req.user.email
  const payment = await one(
    `INSERT INTO payments (student_id, invoice_id, amount_kobo, purpose, method, reference, status, gateway)
     VALUES ($1, $2, $3, $4, 'card', $5, 'pending', 'paystack') RETURNING id`,
    [req.student.id, invoiceId ?? null, amountKobo, purpose, reference],
  )
  try {
    const init = await initializeTransaction({
      email,
      amountKobo,
      reference,
      callbackUrl: `${config.webUrl}/portal/payments?reference=${reference}`,
      metadata: { student_id: req.student.id, student_number: req.student.student_number, payment_id: payment.id, purpose },
    })
    res.json({ authorizationUrl: init.authorization_url, reference })
  } catch (err) {
    await query(`UPDATE payments SET status = 'failed', notes = $2 WHERE id = $1`, [payment.id, err.message])
    throw err
  }
})

// Called when Paystack redirects back. The webhook settles the same payment if this never runs.
student.get('/payments/verify/:reference', async (req, res) => {
  const reference = String(req.params.reference)
  const mine = await one('SELECT id FROM payments WHERE reference = $1 AND student_id = $2', [reference, req.student.id])
  if (!mine) throw notFoundError('Payment not found')
  const data = await verifyTransaction(reference)
  const result = await tx((t) => settleGatewayPayment(t, reference, data))
  if (result?.newlySettled) emailReceipt(db, result.payment.id).catch((e) => console.error(e))
  res.json({ status: result.payment.status, receiptNumber: result.payment.receipt_number, amountKobo: result.payment.amount_kobo })
})

student.get('/payments/:id/receipt.pdf', async (req, res) => {
  const payment = await one(`SELECT * FROM payments WHERE id = $1 AND student_id = $2 AND status = 'success'`, [idParam(req), req.student.id])
  if (!payment) throw notFoundError('Receipt not found')
  const s = await studentForReceipt(db, req.student.id)
  const { balanceKobo } = await accountSummary(db, req.student.id)
  sendPdf(res, `${payment.receipt_number}.pdf`, await receiptPdf({ payment, student: { ...s, balance_kobo: balanceKobo } }))
})

// ── Timetable, attendance, notices ───────────────────────────────────────────

student.get('/timetable', async (req, res) => {
  const entries = req.student.cohort_id
    ? await many(
        `SELECT t.id, t.day_of_week, to_char(t.start_time, 'HH24:MI') AS start_time, to_char(t.end_time, 'HH24:MI') AS end_time,
                t.title, t.instructor, t.venue, c.name AS course_name
           FROM timetable_entries t LEFT JOIN courses c ON c.id = t.course_id
          WHERE t.cohort_id = $1 ORDER BY t.day_of_week, t.start_time`,
        [req.student.cohort_id],
      )
    : []
  res.json({ cohort: req.student.cohort_name, schedule: req.student.cohort_schedule, startsOn: req.student.cohort_starts_on, endsOn: req.student.cohort_ends_on, entries })
})

student.get('/attendance', async (req, res) => {
  const records = req.student.cohort_id
    ? await many('SELECT date, status FROM attendance WHERE student_id = $1 AND cohort_id = $2 ORDER BY date DESC', [req.student.id, req.student.cohort_id])
    : []
  res.json({ summary: await attendanceSummary(req.student), records })
})

student.get('/announcements', async (req, res) => res.json(await announcementsFor(req.student)))

// ── Course outline: programme outline + each course in the student's programme ──

const outlineMeta = (alias) =>
  `(SELECT json_build_object('filename', f.filename, 'size', f.size_bytes) FROM files f WHERE f.id = ${alias}.outline_file_id) AS outline`

student.get('/course-outline', async (req, res) => {
  const pid = req.student.programme_id
  if (!pid) return res.json({ programme: null, courses: [] })
  const [programme, courses] = await Promise.all([
    one(`SELECT p.id, p.name, p.summary, p.curriculum, p.duration_weeks, p.schedule, ${outlineMeta('p')} FROM programmes p WHERE p.id = $1`, [pid]),
    many(
      `SELECT c.id, c.name, c.type, c.description, ${outlineMeta('c')}
         FROM courses c JOIN programme_courses pc ON pc.course_id = c.id
        WHERE pc.programme_id = $1 ORDER BY pc.sort_order, c.name`,
      [pid],
    ),
  ])
  res.json({ programme, courses })
})

student.get('/course-outline/programme/download', async (req, res) => {
  const p = await one('SELECT outline_file_id FROM programmes WHERE id = $1', [req.student.programme_id])
  if (!p?.outline_file_id) throw notFoundError('No programme outline uploaded yet')
  await sendFile(res, db, p.outline_file_id, { inline: false })
})

student.get('/course-outline/courses/:id/download', async (req, res) => {
  // Only courses that belong to the student's programme.
  const c = await one(
    `SELECT c.outline_file_id FROM courses c JOIN programme_courses pc ON pc.course_id = c.id
      WHERE c.id = $1 AND pc.programme_id = $2`,
    [idParam(req), req.student.programme_id],
  )
  if (!c?.outline_file_id) throw notFoundError('No outline uploaded for this course yet')
  await sendFile(res, db, c.outline_file_id, { inline: false })
})

// ── Learning materials & assignments (spec §8.5) ─────────────────────────────

student.get('/materials', async (req, res) => {
  const rows = await many(
    `SELECT m.id, m.title, m.description, m.url, m.created_at, c.name AS course_name,
            f.filename, f.mime_type, f.size_bytes
       FROM materials m
       LEFT JOIN courses c ON c.id = m.course_id
       LEFT JOIN files f ON f.id = m.file_id
      WHERE m.is_published
        AND (m.cohort_id = $2 OR (m.cohort_id IS NULL AND (m.programme_id = $1 OR m.programme_id IS NULL)))
      ORDER BY c.name NULLS LAST, m.created_at DESC`,
    [req.student.programme_id, req.student.cohort_id],
  )
  res.json(rows)
})

student.get('/materials/:id/download', async (req, res) => {
  const m = await one(
    `SELECT file_id FROM materials WHERE id = $1 AND is_published AND file_id IS NOT NULL
        AND (cohort_id = $3 OR (cohort_id IS NULL AND (programme_id = $2 OR programme_id IS NULL)))`,
    [idParam(req), req.student.programme_id, req.student.cohort_id],
  )
  if (!m) throw notFoundError('Material not found')
  await sendFile(res, db, m.file_id, { inline: false })
})

student.get('/assignments', async (req, res) => {
  if (!req.student.cohort_id) return res.json([])
  const rows = await many(
    `SELECT a.id, a.title, a.description, a.due_at, c.name AS course_name,
            s.id AS submission_id, s.submitted_at, s.note, s.feedback, s.score, s.reviewed_at, f.filename
       FROM assignments a
       LEFT JOIN courses c ON c.id = a.course_id
       LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = $2
       LEFT JOIN files f ON f.id = s.file_id
      WHERE a.cohort_id = $1 ORDER BY a.due_at NULLS LAST, a.created_at DESC`,
    [req.student.cohort_id, req.student.id],
  )
  res.json(rows)
})

student.post('/assignments/:id/submit', upload.single('file'), async (req, res) => {
  const assignmentId = idParam(req)
  const { note } = parse(z.object({ note: optionalText(3000) }), req.body)
  const a = await one('SELECT * FROM assignments WHERE id = $1 AND cohort_id = $2', [assignmentId, req.student.cohort_id])
  if (!a) throw notFoundError('Assignment not found')
  if (a.due_at && new Date(a.due_at) < new Date()) throw badRequest('The deadline for this assignment has passed')
  if (!req.file && !note) throw badRequest('Attach a file or write a note')
  const existing = await one('SELECT * FROM submissions WHERE assignment_id = $1 AND student_id = $2', [assignmentId, req.student.id])
  if (existing?.reviewed_at) throw badRequest('This submission has already been marked')

  await tx(async (t) => {
    const f = req.file ? await storeFile(t, req.file, req.user.id, MATERIAL_TYPES) : null
    await t.query(
      `INSERT INTO submissions (assignment_id, student_id, note, file_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (assignment_id, student_id) DO UPDATE
         SET note = EXCLUDED.note, file_id = COALESCE(EXCLUDED.file_id, submissions.file_id), submitted_at = now()`,
      [assignmentId, req.student.id, note, f?.id ?? null],
    )
    if (f && existing?.file_id) await t.query('DELETE FROM files WHERE id = $1', [existing.file_id])
  })
  res.status(201).json({ ok: true })
})

student.get('/submissions/:id/file', async (req, res) => {
  const s = await one('SELECT file_id FROM submissions WHERE id = $1 AND student_id = $2', [idParam(req), req.student.id])
  if (!s?.file_id) throw notFoundError()
  await sendFile(res, db, s.file_id, { inline: false })
})

// ── Certificates ─────────────────────────────────────────────────────────────

student.get('/certificates', async (req, res) => {
  res.json(await many(
    `SELECT id, title, grade, issued_on, serial, verification_code FROM certificates
      WHERE student_id = $1 AND revoked_at IS NULL ORDER BY issued_on DESC`,
    [req.student.id],
  ))
})

student.get('/certificates/:id/pdf', async (req, res) => {
  const cert = await one('SELECT * FROM certificates WHERE id = $1 AND student_id = $2 AND revoked_at IS NULL', [idParam(req), req.student.id])
  if (!cert) throw notFoundError('Certificate not found')
  sendPdf(res, `certificate-${cert.serial}.pdf`, await certificatePdf({ certificate: cert, student: req.student }))
})

// ── Requests & feedback ──────────────────────────────────────────────────────

student.get('/requests', async (req, res) => {
  res.json(await many('SELECT id, type, details, status, response, created_at, updated_at FROM student_requests WHERE student_id = $1 ORDER BY created_at DESC', [req.student.id]))
})

student.post('/requests', async (req, res) => {
  const b = parse(z.object({ type: z.enum(['transcript', 'recommendation', 'change_of_details', 'other']), details: requiredText(3000) }), req.body)
  const open = await one(`SELECT COUNT(*)::int AS n FROM student_requests WHERE student_id = $1 AND status IN ('open', 'in_progress')`, [req.student.id])
  if (open.n >= 10) throw badRequest('You have too many open requests. Please wait for the academy to respond.')
  const row = await one('INSERT INTO student_requests (student_id, type, details) VALUES ($1, $2, $3) RETURNING *', [req.student.id, b.type, b.details])
  res.status(201).json(row)
})

student.get('/feedback', async (req, res) => {
  const [courses, given] = await Promise.all([
    req.student.programme_id
      ? many('SELECT c.id, c.name FROM courses c JOIN programme_courses pc ON pc.course_id = c.id WHERE pc.programme_id = $1 ORDER BY pc.sort_order, c.name', [req.student.programme_id])
      : [],
    many('SELECT f.id, f.rating, f.comments, f.created_at, c.name AS course_name FROM feedback f LEFT JOIN courses c ON c.id = f.course_id WHERE f.student_id = $1 ORDER BY f.created_at DESC', [req.student.id]),
  ])
  res.json({ courses, given })
})

student.post('/feedback', async (req, res) => {
  const b = parse(z.object({ courseId: id.optional().nullable(), rating: z.coerce.number().int().min(1).max(5), comments: optionalText(3000) }), req.body)
  const row = await one(
    'INSERT INTO feedback (student_id, cohort_id, course_id, rating, comments) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [req.student.id, req.student.cohort_id, b.courseId ?? null, b.rating, b.comments],
  )
  res.status(201).json(row)
})
