// Student records: list, profile, create, edit, archive, bulk CSV import, account access (spec §9.3).
import { z } from 'zod'
import {
  Student, Programme, Cohort, User, Invoice, Payment, Result, Course, Attendance, Certificate, StudentRequest, Session, Application,
  Submission, Feedback, DocumentVerification,
} from '../../db/models.js'
import { withTransaction, oid } from '../../db/mongo.js'
import { parse, idParam, pagination, paged, requiredText, optionalText, optionalDate, email, optionalId } from '../../lib/validate.js'
import { resolveUpload, sendFile, deleteFile, getFileBuffer } from '../../lib/storage.js'
import { readCsv, sendCsv } from '../../lib/csv.js'
import { audit } from '../../lib/audit.js'
import { accountSummary } from '../../lib/finance.js'
import { idCardPdf } from '../../lib/pdf.js'
import { nextStudentNumber, raiseTuitionCharges, ensureStudentAccount, sendAccountSetupEmail } from '../../lib/students.js'
import { tempPassword, hashPassword } from '../../lib/security.js'
import { byIds, pick, contains, escapeRegex } from '../../lib/lookup.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { Router, badRequest, notFoundError, defer } from '../../http.js'

export const students = new Router()

const STATUSES = ['active', 'suspended', 'graduated', 'withdrawn', 'archived']

function filter(f) {
  const q = f.status ? { status: f.status } : { status: { $ne: 'archived' } }
  if (f.cohortId) q.cohort_id = f.cohortId
  if (f.programmeId) q.programme_id = f.programmeId
  if (f.q) {
    const re = contains(f.q)
    const parts = f.q.trim().split(/\s+/)
    q.$or = [{ first_name: re }, { last_name: re }, { student_number: re }, { email: re }, { phone: re }]
    if (parts.length > 1) q.$or.push({ first_name: new RegExp(escapeRegex(parts[0]), 'i'), last_name: new RegExp(escapeRegex(parts.slice(1).join(' ')), 'i') })
  }
  return q
}

/** Balance per student id (charges − credits − successful payments). */
async function balances(ids) {
  const sids = ids.map(oid)
  const [inv, pay] = await Promise.all([
    Invoice.aggregate([
      { $match: { student_id: { $in: sids }, voided_at: null } },
      { $group: { _id: '$student_id', net: { $sum: { $cond: [{ $eq: ['$kind', 'charge'] }, '$amount_kobo', { $multiply: ['$amount_kobo', -1] }] } } } },
    ]),
    Payment.aggregate([{ $match: { student_id: { $in: sids }, status: 'success' } }, { $group: { _id: '$student_id', paid: { $sum: '$amount_kobo' } } }]),
  ])
  const map = new Map(inv.map((r) => [String(r._id), r.net]))
  for (const p of pay) map.set(String(p._id), (map.get(String(p._id)) ?? 0) - p.paid)
  return map
}

async function listRows(rows) {
  const [programmes, cohorts, bal] = await Promise.all([
    byIds(Programme, rows.map((s) => s.programme_id), 'name'),
    byIds(Cohort, rows.map((s) => s.cohort_id), 'name'),
    balances(rows.map((s) => s._id)),
  ])
  return rows.map((s) => ({
    id: String(s._id), student_number: s.student_number, first_name: s.first_name, last_name: s.last_name, email: s.email, phone: s.phone,
    status: s.status, enrolled_on: s.enrolled_on, programme_id: s.programme_id ? String(s.programme_id) : null, cohort_id: s.cohort_id ? String(s.cohort_id) : null,
    programme_name: pick(programmes, s.programme_id, 'name'), cohort_name: pick(cohorts, s.cohort_id, 'name'), balance_kobo: bal.get(String(s._id)) ?? 0,
  }))
}

const listSchema = pagination.extend({
  status: z.enum(STATUSES).optional().or(z.literal('')),
  cohortId: optionalId,
  programmeId: optionalId,
})

students.get('/', async (req, res) => {
  const f = parse(listSchema, req.query)
  const q = filter(f)
  const [rows, total] = await Promise.all([
    Student.find(q).sort({ last_name: 1, first_name: 1 }).skip((f.page - 1) * f.pageSize).limit(f.pageSize).lean(),
    Student.countDocuments(q),
  ])
  res.json(paged(await listRows(rows), total, f))
})

students.get('/export.csv', async (req, res) => {
  const rows = await listRows(await Student.find(filter(parse(listSchema, req.query))).sort({ last_name: 1, first_name: 1 }).lean())
  await audit(req, 'students.export', 'student', null, { count: rows.length })
  sendCsv(res, 'students.csv', rows, [
    { key: 'student_number', label: 'Student ID' }, { key: 'first_name', label: 'First name' }, { key: 'last_name', label: 'Last name' },
    { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'programme_name', label: 'Programme' },
    { key: 'cohort_name', label: 'Cohort' }, { key: 'status', label: 'Status' }, { key: 'enrolled_on', label: 'Enrolled' },
    { label: 'Balance (NGN)', value: (r) => (r.balance_kobo / 100).toFixed(2) },
  ])
})

students.get('/import-template.csv', (req, res) => {
  sendCsv(res, 'student-import-template.csv', [
    { first_name: 'Ada', last_name: 'Okafor', email: 'ada@example.com', phone: '08012345678', gender: 'Female', date_of_birth: '2001-04-12', programme: 'african-and-asian-cuisine', cohort: 'PC Jan 2027', guardian_name: 'Chidi Okafor', guardian_phone: '08098765432', student_number: '' },
  ])
})

students.get('/:id', async (req, res) => {
  const sid = idParam(req)
  const s = await Student.findById(sid).lean()
  if (!s) throw notFoundError('Student not found')
  const [programme, cohort, user, account, payments, invoices, results, attendance, certificates, requests] = await Promise.all([
    s.programme_id ? Programme.findById(s.programme_id, 'name').lean() : null,
    s.cohort_id ? Cohort.findById(s.cohort_id, 'name').lean() : null,
    s.user_id ? User.findById(s.user_id, 'email is_active last_login_at two_factor_enabled locked_until').lean() : null,
    accountSummary(sid),
    Payment.find({ student_id: sid }, 'amount_kobo purpose method reference receipt_number status paid_at created_at').sort({ created_at: -1 }).lean(),
    Invoice.find({ student_id: sid }).sort({ created_at: 1 }).lean(),
    Result.find({ student_id: sid }, 'cohort_id course_id total grade status').lean(),
    Attendance.find({ student_id: sid }, 'status').lean(),
    Certificate.find({ student_id: sid }, 'title serial issued_on revoked_at').sort({ issued_on: -1 }).lean(),
    StudentRequest.find({ student_id: sid }, 'type status created_at').sort({ created_at: -1 }).limit(10).lean(),
  ])
  const [cohorts, courses] = await Promise.all([
    byIds(Cohort, results.map((r) => r.cohort_id), 'name starts_on'),
    byIds(Course, results.map((r) => r.course_id), 'name'),
  ])
  const resultRows = results
    .map((r) => ({ id: r._id, cohort_id: String(r.cohort_id), cohort_name: pick(cohorts, r.cohort_id, 'name'), cohort_starts: pick(cohorts, r.cohort_id, 'starts_on') ?? '', course_name: pick(courses, r.course_id, 'name'), total: r.total, grade: r.grade, status: r.status }))
    .sort((a, b) => b.cohort_starts.localeCompare(a.cohort_starts) || (a.course_name ?? '').localeCompare(b.course_name ?? ''))
  res.json({
    ...s,
    programme_name: programme?.name ?? null,
    cohort_name: cohort?.name ?? null,
    login_email: user?.email ?? null,
    account_active: user?.is_active ?? null,
    last_login_at: user?.last_login_at ?? null,
    two_factor_enabled: user?.two_factor_enabled ?? null,
    locked_until: user?.locked_until ?? null,
    account, payments, invoices, results: resultRows,
    attendance: { total: attendance.length, attended: attendance.filter((a) => ['present', 'late'].includes(a.status)).length },
    certificates, requests,
  })
})

const studentFields = {
  firstName: requiredText(80),
  lastName: requiredText(80),
  email: email.optional().or(z.literal('').transform(() => undefined)),
  phone: optionalText(30),
  gender: optionalText(20),
  dateOfBirth: optionalDate,
  address: optionalText(300),
  city: optionalText(100),
  state: optionalText(100),
  guardianName: optionalText(120),
  guardianPhone: optionalText(30),
  guardianRelationship: optionalText(60),
  sponsor: optionalText(160),
  programmeId: optionalId,
  cohortId: optionalId,
  notes: optionalText(5000),
}

async function resolveCohort(session, programmeId, cohortId) {
  if (!cohortId) return programmeId
  const c = await Cohort.findById(cohortId, 'programme_id').session(session ?? null).lean()
  if (!c) throw badRequest('Cohort not found', { cohortId: 'Not found' })
  if (programmeId && String(c.programme_id) !== String(programmeId)) throw badRequest('Cohort belongs to a different programme', { cohortId: 'Wrong programme' })
  return c.programme_id
}

students.post('/', async (req, res) => {
  const b = parse(z.object({ ...studentFields, createAccount: z.boolean().default(true), raiseCharges: z.boolean().default(true) }), req.body)
  if (b.createAccount && !b.email) throw badRequest('An email is needed to create a portal account', { email: 'Required for portal access' })
  const result = await withTransaction(async (session) => {
    const programmeId = await resolveCohort(session, b.programmeId, b.cohortId)
    const account = b.createAccount ? await ensureStudentAccount(session, { email: b.email, fullName: `${b.firstName} ${b.lastName}`, phone: b.phone }) : null
    if (account && (await Student.exists({ user_id: account.user._id }).session(session))) throw badRequest('A student with this email already exists', { email: 'Already a student' })
    const [s] = await Student.create([{
      user_id: account?.user._id ?? null, student_number: await nextStudentNumber(session), first_name: b.firstName, last_name: b.lastName,
      email: b.email ?? null, phone: b.phone, gender: b.gender, date_of_birth: b.dateOfBirth ?? null, address: b.address, city: b.city, state: b.state,
      guardian_name: b.guardianName, guardian_phone: b.guardianPhone, guardian_relationship: b.guardianRelationship, sponsor: b.sponsor,
      programme_id: programmeId, cohort_id: b.cohortId, notes: b.notes,
    }], { session })
    if (b.raiseCharges && programmeId) await raiseTuitionCharges(session, { studentId: s._id, programmeId, cohortId: b.cohortId, userId: req.user.id })
    await audit(req, 'student.create', 'student', s._id, { studentNumber: s.student_number }, session)
    return { s: s.toObject(), account }
  })
  if (result.account) defer(() => sendAccountSetupEmail({ email: b.email, firstName: b.firstName, studentNumber: result.s.student_number, setupToken: result.account.setupToken, sentBy: req.user.id }))
  res.status(201).json(result.s)
})

students.patch('/:id', async (req, res) => {
  const sid = idParam(req)
  const b = parse(z.object({ ...studentFields, status: z.enum(STATUSES).optional(), graduatedOn: optionalDate }).partial(), req.body)
  const before = await Student.findById(sid).lean()
  if (!before) throw notFoundError('Student not found')
  const programmeId = 'cohortId' in b || 'programmeId' in b
    ? await resolveCohort(null, b.programmeId ?? before.programme_id, 'cohortId' in b ? b.cohortId : before.cohort_id)
    : before.programme_id
  const map = {
    first_name: b.firstName, last_name: b.lastName, email: b.email, phone: b.phone, gender: b.gender, date_of_birth: b.dateOfBirth,
    address: b.address, city: b.city, state: b.state, guardian_name: b.guardianName, guardian_phone: b.guardianPhone,
    guardian_relationship: b.guardianRelationship, sponsor: b.sponsor, cohort_id: b.cohortId, notes: b.notes, status: b.status,
    graduated_on: b.graduatedOn,
  }
  const set = { programme_id: programmeId }
  for (const [k, v] of Object.entries(map)) if (v !== undefined) set[k] = v
  if (b.status === 'graduated' && !b.graduatedOn && !before.graduated_on) set.graduated_on = new Date().toISOString().slice(0, 10)
  const row = await Student.findByIdAndUpdate(sid, { $set: set }, { returnDocument: 'after' }).lean()
  if ((b.firstName || b.lastName) && row.user_id) await User.updateOne({ _id: row.user_id }, { $set: { full_name: `${row.first_name} ${row.last_name}` } })
  await audit(req, 'student.update', 'student', sid, b)
  res.json(row)
})

students.delete('/:id', requireSuperAdmin, async (req, res) => {
  // Permanent erasure (NDPA data-deletion requests). Normal practice is to archive instead.
  const sid = idParam(req)
  const s = await Student.findById(sid).lean()
  if (!s) throw notFoundError()
  await withTransaction(async (session) => {
    for (const M of [Invoice, Payment, Result, Attendance, Certificate, StudentRequest, Submission, Feedback, DocumentVerification]) {
      await M.deleteMany({ student_id: sid }, { session })
    }
    await Student.deleteOne({ _id: sid }, { session })
    if (s.user_id) {
      await Session.deleteMany({ user_id: s.user_id }, { session })
      await Application.deleteMany({ user_id: s.user_id }, { session })
      await User.deleteOne({ _id: s.user_id }, { session })
    }
    await audit(req, 'student.delete', 'student', sid, { studentNumber: s.student_number, name: `${s.first_name} ${s.last_name}` }, session)
  })
  res.json({ ok: true })
})

// ── Account access ───────────────────────────────────────────────────────────

students.post('/:id/account', async (req, res) => {
  const sid = idParam(req)
  const s = await Student.findById(sid).lean()
  if (!s) throw notFoundError()
  if (s.user_id) throw badRequest('This student already has a portal account')
  if (!s.email) throw badRequest('Add an email address to the student first')
  const account = await withTransaction(async (session) => {
    const a = await ensureStudentAccount(session, { email: s.email, fullName: `${s.first_name} ${s.last_name}`, phone: s.phone })
    await Student.updateOne({ _id: sid }, { $set: { user_id: a.user._id } }, { session })
    return a
  })
  defer(() => sendAccountSetupEmail({ email: s.email, firstName: s.first_name, studentNumber: s.student_number, setupToken: account.setupToken, sentBy: req.user.id }))
  await audit(req, 'student.account_create', 'student', sid)
  res.json({ ok: true })
})

students.post('/:id/reset-password', async (req, res) => {
  const s = await Student.findById(idParam(req), 'user_id').lean()
  if (!s?.user_id) throw badRequest('This student has no portal account')
  const temp = tempPassword()
  const hash = await hashPassword(temp)
  await withTransaction(async (session) => {
    await User.updateOne({ _id: s.user_id }, { $set: { password_hash: hash, must_change_password: true, failed_logins: 0, locked_until: null } }, { session })
    await Session.updateMany({ user_id: s.user_id, revoked_at: null }, { $set: { revoked_at: new Date() } }, { session })
  })
  await audit(req, 'student.password_reset', 'student', idParam(req))
  // Shown once to the staff member, who passes it to the student in person.
  res.json({ temporaryPassword: temp })
})

students.post('/:id/account-status', async (req, res) => {
  const { active } = parse(z.object({ active: z.boolean() }), req.body)
  const s = await Student.findById(idParam(req), 'user_id').lean()
  if (!s?.user_id) throw badRequest('This student has no portal account')
  await User.updateOne({ _id: s.user_id }, { $set: { is_active: active, locked_until: null, failed_logins: 0 } })
  if (!active) await Session.updateMany({ user_id: s.user_id, revoked_at: null }, { $set: { revoked_at: new Date() } })
  await audit(req, active ? 'student.account_enable' : 'student.account_disable', 'student', idParam(req))
  res.json({ ok: true })
})

// ── Photo & ID card ──────────────────────────────────────────────────────────

students.get('/:id/photo', async (req, res) => {
  const s = await Student.findById(idParam(req), 'photo_file_id').lean()
  if (!s?.photo_file_id) throw notFoundError('No photo')
  await sendFile(res, s.photo_file_id)
})

students.post('/:id/photo', async (req, res) => {
  const sid = idParam(req)
  const s = await Student.findById(sid, 'photo_file_id').lean()
  if (!s) throw notFoundError()
  const f = await resolveUpload(req, { purpose: 'profile_photo' })
  if (!f) throw badRequest('Please attach a photo')
  await Student.updateOne({ _id: sid }, { $set: { photo_file_id: f._id } })
  if (s.photo_file_id && !(await Application.exists({ 'documents.file_id': s.photo_file_id }))) await deleteFile(s.photo_file_id)
  res.status(201).json({ ok: true })
})

students.get('/:id/id-card.pdf', async (req, res) => {
  const s = await Student.findById(idParam(req)).lean()
  if (!s) throw notFoundError()
  const [p, c] = await Promise.all([
    s.programme_id ? Programme.findById(s.programme_id, 'name').lean() : null,
    s.cohort_id ? Cohort.findById(s.cohort_id, 'name').lean() : null,
  ])
  const photo = s.photo_file_id ? await getFileBuffer(s.photo_file_id) : null
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="id-card-${s.student_number.replace(/\//g, '-')}.pdf"`)
  res.send(await idCardPdf({ student: { ...s, programme_name: p?.name, cohort_name: c?.name }, photo }))
})

// ── Bulk import (spec §9.3 "bulk import from Excel") ─────────────────────────

const importRow = z.object({
  first_name: requiredText(80),
  last_name: requiredText(80),
  email: email.optional().or(z.literal('').transform(() => undefined)),
  phone: optionalText(30),
  gender: optionalText(20),
  date_of_birth: optionalDate,
  programme: optionalText(200),
  cohort: optionalText(200),
  guardian_name: optionalText(120),
  guardian_phone: optionalText(30),
  student_number: optionalText(40),
})

students.post('/import', async (req, res) => {
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true'
  const createAccounts = req.query.accounts !== '0'
  if (!req.file) throw badRequest('Attach a CSV file')
  let records
  try {
    records = readCsv(req.file.buffer)
  } catch (err) {
    throw badRequest(`Could not read the CSV: ${err.message}`)
  }
  if (!records.length) throw badRequest('The file has no rows')
  if (records.length > 2000) throw badRequest('Import at most 2,000 students at a time')

  const programmes = (await Programme.find({}, 'slug name').lean()).map((p) => ({ ...p, lname: p.name.toLowerCase() }))
  const cohorts = (await Cohort.find({}, 'name programme_id').lean()).map((c) => ({ ...c, lname: c.name.toLowerCase() }))
  const errors = []
  const valid = []
  const seenEmails = new Set()
  for (const [i, raw] of records.entries()) {
    const line = i + 2 // header is line 1
    const r = importRow.safeParse(raw)
    if (!r.success) {
      errors.push({ line, error: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') })
      continue
    }
    const row = r.data
    const prog = row.programme ? programmes.find((p) => p.slug === row.programme.toLowerCase() || p.lname === row.programme.toLowerCase()) : null
    if (row.programme && !prog) { errors.push({ line, error: `Unknown programme "${row.programme}"` }); continue }
    const cohort = row.cohort ? cohorts.find((c) => c.lname === row.cohort.toLowerCase() && (!prog || String(c.programme_id) === String(prog._id))) : null
    if (row.cohort && !cohort) { errors.push({ line, error: `Unknown cohort "${row.cohort}"` }); continue }
    if (row.email) {
      if (seenEmails.has(row.email)) { errors.push({ line, error: `Duplicate email ${row.email} in file` }); continue }
      seenEmails.add(row.email)
    }
    valid.push({ line, ...row, programmeId: prog?._id ?? cohort?.programme_id ?? null, cohortId: cohort?._id ?? null })
  }

  // Duplicates against existing records.
  const emails = valid.filter((v) => v.email).map((v) => v.email)
  const existingSet = new Set((emails.length ? await Student.find({ email: { $in: emails } }, 'email').lean() : []).map((e) => e.email?.toLowerCase()))
  const numbers = valid.filter((v) => v.student_number).map((v) => v.student_number.toUpperCase())
  const existingNums = new Set((numbers.length ? await Student.find({ student_number: { $in: numbers } }, 'student_number').lean() : []).map((r) => r.student_number.toUpperCase()))
  const toInsert = valid.filter((v) => {
    if (v.email && existingSet.has(v.email)) { errors.push({ line: v.line, error: `A student with email ${v.email} already exists` }); return false }
    if (v.student_number && existingNums.has(v.student_number.toUpperCase())) { errors.push({ line: v.line, error: `Student ID ${v.student_number} already exists` }); return false }
    return true
  })
  errors.sort((a, b) => a.line - b.line)

  if (dryRun || errors.length) return res.json({ dryRun: true, total: records.length, valid: toInsert.length, errors, imported: 0 })

  const created = await withTransaction(async (session) => {
    const out = []
    for (const v of toInsert) {
      const account = createAccounts && v.email ? await ensureStudentAccount(session, { email: v.email, fullName: `${v.first_name} ${v.last_name}`, phone: v.phone }) : null
      const [s] = await Student.create([{
        user_id: account?.user._id ?? null, student_number: v.student_number || (await nextStudentNumber(session)), first_name: v.first_name,
        last_name: v.last_name, email: v.email ?? null, phone: v.phone, gender: v.gender, date_of_birth: v.date_of_birth ?? null,
        guardian_name: v.guardian_name, guardian_phone: v.guardian_phone, programme_id: v.programmeId, cohort_id: v.cohortId,
      }], { session })
      out.push({ student_number: s.student_number, first_name: s.first_name, email: s.email, setupToken: account?.setupToken })
    }
    await audit(req, 'students.import', 'student', null, { count: out.length }, session)
    return out
  })
  defer(async () => {
    for (const s of created) {
      if (s.setupToken) await sendAccountSetupEmail({ email: s.email, firstName: s.first_name, studentNumber: s.student_number, setupToken: s.setupToken, sentBy: req.user.id })
    }
  })
  res.json({ dryRun: false, total: records.length, valid: created.length, errors: [], imported: created.length })
})
