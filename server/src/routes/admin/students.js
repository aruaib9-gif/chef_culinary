// Student records: list, profile, create, edit, archive, bulk CSV import, account access (spec §9.3).
import { Router } from 'express'
import { z } from 'zod'
import { many, one, query, tx, db } from '../../db/pool.js'
import { parse, idParam, pagination, paged, requiredText, optionalText, optionalDate, email, optionalId } from '../../lib/validate.js'
import { upload, storeFile, sendFile, IMAGE_TYPES } from '../../lib/files.js'
import { readCsv, sendCsv } from '../../lib/csv.js'
import { audit } from '../../lib/audit.js'
import { accountSummary } from '../../lib/finance.js'
import { idCardPdf } from '../../lib/pdf.js'
import { nextStudentNumber, raiseTuitionCharges, ensureStudentAccount, sendAccountSetupEmail } from '../../lib/students.js'
import { tempPassword, hashPassword } from '../../lib/security.js'
import { requireSuperAdmin } from '../../middleware/auth.js'
import { badRequest, notFoundError } from '../../middleware/errors.js'

export const students = Router()

const STATUSES = ['active', 'suspended', 'graduated', 'withdrawn', 'archived']

const LIST_SQL = `
  SELECT s.id, s.student_number, s.first_name, s.last_name, s.email, s.phone, s.status, s.enrolled_on,
         p.name AS programme_name, c.name AS cohort_name, s.cohort_id, s.programme_id,
         COALESCE(ch.total, 0) - COALESCE(cr.total, 0) - COALESCE(pd.total, 0) AS balance_kobo
    FROM students s
    LEFT JOIN programmes p ON p.id = s.programme_id
    LEFT JOIN cohorts c ON c.id = s.cohort_id
    LEFT JOIN LATERAL (SELECT SUM(amount_kobo) AS total FROM invoices WHERE student_id = s.id AND voided_at IS NULL AND kind = 'charge') ch ON true
    LEFT JOIN LATERAL (SELECT SUM(amount_kobo) AS total FROM invoices WHERE student_id = s.id AND voided_at IS NULL AND kind <> 'charge') cr ON true
    LEFT JOIN LATERAL (SELECT SUM(amount_kobo) AS total FROM payments WHERE student_id = s.id AND status = 'success') pd ON true`

function filters(f) {
  const params = []
  const clauses = []
  if (f.status) clauses.push(`s.status = $${params.push(f.status)}`)
  else clauses.push(`s.status <> 'archived'`)
  if (f.cohortId) clauses.push(`s.cohort_id = $${params.push(f.cohortId)}`)
  if (f.programmeId) clauses.push(`s.programme_id = $${params.push(f.programmeId)}`)
  if (f.q) {
    params.push(`%${f.q}%`)
    clauses.push(`(s.first_name || ' ' || s.last_name ILIKE $${params.length} OR s.student_number ILIKE $${params.length} OR s.email ILIKE $${params.length} OR s.phone ILIKE $${params.length})`)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params }
}

const listSchema = pagination.extend({
  status: z.enum(STATUSES).optional().or(z.literal('')),
  cohortId: optionalId,
  programmeId: optionalId,
})

students.get('/', async (req, res) => {
  const f = parse(listSchema, req.query)
  const { where, params } = filters(f)
  const rows = await many(
    `SELECT *, COUNT(*) OVER() AS total_count FROM (${LIST_SQL} ${where}) x
      ORDER BY last_name, first_name LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
    params,
  )
  res.json(paged(rows, f))
})

students.get('/export.csv', async (req, res) => {
  const f = parse(listSchema, req.query)
  const { where, params } = filters(f)
  const rows = await many(`${LIST_SQL} ${where} ORDER BY s.last_name, s.first_name`, params)
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
    { first_name: 'Ada', last_name: 'Okafor', email: 'ada@example.com', phone: '08012345678', gender: 'Female', date_of_birth: '2001-04-12', programme: 'professional-cookery', cohort: 'PC Jan 2027', guardian_name: 'Chidi Okafor', guardian_phone: '08098765432', student_number: '' },
  ])
})

students.get('/:id', async (req, res) => {
  const sid = idParam(req)
  const s = await one(
    `SELECT s.*, p.name AS programme_name, c.name AS cohort_name, u.email AS login_email, u.is_active AS account_active,
            u.last_login_at, u.two_factor_enabled, u.locked_until
       FROM students s LEFT JOIN programmes p ON p.id = s.programme_id LEFT JOIN cohorts c ON c.id = s.cohort_id
       LEFT JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [sid],
  )
  if (!s) throw notFoundError('Student not found')
  const [account, payments, invoices, results, attendance, certificates, requests] = await Promise.all([
    accountSummary(db, sid),
    many(`SELECT id, amount_kobo, purpose, method, reference, receipt_number, status, paid_at, created_at FROM payments WHERE student_id = $1 ORDER BY created_at DESC`, [sid]),
    many(`SELECT * FROM invoices WHERE student_id = $1 ORDER BY created_at`, [sid]),
    many(`SELECT r.id, r.cohort_id, co.name AS cohort_name, c.name AS course_name, r.total, r.grade, r.status
            FROM results r JOIN courses c ON c.id = r.course_id JOIN cohorts co ON co.id = r.cohort_id
           WHERE r.student_id = $1 ORDER BY co.starts_on DESC NULLS LAST, c.name`, [sid]),
    one(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS attended FROM attendance WHERE student_id = $1`, [sid]),
    many(`SELECT id, title, serial, issued_on, revoked_at FROM certificates WHERE student_id = $1 ORDER BY issued_on DESC`, [sid]),
    many(`SELECT id, type, status, created_at FROM student_requests WHERE student_id = $1 ORDER BY created_at DESC LIMIT 10`, [sid]),
  ])
  res.json({ ...s, account, payments, invoices, results, attendance, certificates, requests })
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

async function resolveCohort(t, programmeId, cohortId) {
  if (!cohortId) return programmeId
  const c = await t.one('SELECT programme_id FROM cohorts WHERE id = $1', [cohortId])
  if (!c) throw badRequest('Cohort not found', { cohortId: 'Not found' })
  if (programmeId && c.programme_id !== programmeId) throw badRequest('Cohort belongs to a different programme', { cohortId: 'Wrong programme' })
  return c.programme_id
}

students.post('/', async (req, res) => {
  const b = parse(z.object({ ...studentFields, createAccount: z.boolean().default(true), raiseCharges: z.boolean().default(true) }), req.body)
  if (b.createAccount && !b.email) throw badRequest('An email is needed to create a portal account', { email: 'Required for portal access' })
  const result = await tx(async (t) => {
    const programmeId = await resolveCohort(t, b.programmeId, b.cohortId)
    const account = b.createAccount ? await ensureStudentAccount(t, { email: b.email, fullName: `${b.firstName} ${b.lastName}`, phone: b.phone }) : null
    if (account && (await t.one('SELECT 1 FROM students WHERE user_id = $1', [account.user.id]))) throw badRequest('A student with this email already exists', { email: 'Already a student' })
    const s = await t.one(
      `INSERT INTO students (user_id, student_number, first_name, last_name, email, phone, gender, date_of_birth, address, city, state,
                             guardian_name, guardian_phone, guardian_relationship, sponsor, programme_id, cohort_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [account?.user.id ?? null, await nextStudentNumber(t), b.firstName, b.lastName, b.email ?? null, b.phone, b.gender, b.dateOfBirth ?? null,
        b.address, b.city, b.state, b.guardianName, b.guardianPhone, b.guardianRelationship, b.sponsor, programmeId, b.cohortId, b.notes],
    )
    if (b.raiseCharges && programmeId) await raiseTuitionCharges(t, { studentId: s.id, programmeId, cohortId: b.cohortId, userId: req.user.id })
    await audit(req, 'student.create', 'student', s.id, { studentNumber: s.student_number }, t)
    return { s, account }
  })
  if (result.account) await sendAccountSetupEmail({ email: b.email, firstName: b.firstName, studentNumber: result.s.student_number, setupToken: result.account.setupToken, sentBy: req.user.id })
  res.status(201).json(result.s)
})

students.patch('/:id', async (req, res) => {
  const sid = idParam(req)
  const b = parse(z.object({ ...studentFields, status: z.enum(STATUSES).optional(), graduatedOn: optionalDate }).partial(), req.body)
  const before = await one('SELECT * FROM students WHERE id = $1', [sid])
  if (!before) throw notFoundError('Student not found')
  const updated = await tx(async (t) => {
    const programmeId = 'cohortId' in b || 'programmeId' in b
      ? await resolveCohort(t, b.programmeId ?? before.programme_id, 'cohortId' in b ? b.cohortId : before.cohort_id)
      : before.programme_id
    const map = {
      first_name: b.firstName, last_name: b.lastName, email: b.email, phone: b.phone, gender: b.gender, date_of_birth: b.dateOfBirth,
      address: b.address, city: b.city, state: b.state, guardian_name: b.guardianName, guardian_phone: b.guardianPhone,
      guardian_relationship: b.guardianRelationship, sponsor: b.sponsor, cohort_id: b.cohortId, notes: b.notes, status: b.status,
      graduated_on: b.graduatedOn,
    }
    const sets = []
    const params = [sid]
    for (const [col, val] of Object.entries(map)) if (val !== undefined) sets.push(`${col} = $${params.push(val)}`)
    sets.push(`programme_id = $${params.push(programmeId)}`)
    if (b.status === 'graduated' && !b.graduatedOn) sets.push('graduated_on = COALESCE(graduated_on, CURRENT_DATE)')
    const row = await t.one(`UPDATE students SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, params)
    if (b.firstName || b.lastName) await t.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [row.user_id, `${row.first_name} ${row.last_name}`])
    return row
  })
  await audit(req, 'student.update', 'student', sid, b)
  res.json(updated)
})

students.delete('/:id', requireSuperAdmin, async (req, res) => {
  // Permanent erasure (NDPA data-deletion requests). Normal practice is to archive instead.
  const sid = idParam(req)
  const s = await one('SELECT * FROM students WHERE id = $1', [sid])
  if (!s) throw notFoundError()
  await tx(async (t) => {
    await t.query('DELETE FROM students WHERE id = $1', [sid])
    if (s.user_id) await t.query('DELETE FROM users WHERE id = $1', [s.user_id])
    await audit(req, 'student.delete', 'student', sid, { studentNumber: s.student_number, name: `${s.first_name} ${s.last_name}` }, t)
  })
  res.json({ ok: true })
})

// ── Account access ───────────────────────────────────────────────────────────

students.post('/:id/account', async (req, res) => {
  const sid = idParam(req)
  const s = await one('SELECT * FROM students WHERE id = $1', [sid])
  if (!s) throw notFoundError()
  if (s.user_id) throw badRequest('This student already has a portal account')
  if (!s.email) throw badRequest('Add an email address to the student first')
  const account = await tx(async (t) => {
    const a = await ensureStudentAccount(t, { email: s.email, fullName: `${s.first_name} ${s.last_name}`, phone: s.phone })
    await t.query('UPDATE students SET user_id = $2 WHERE id = $1', [sid, a.user.id])
    return a
  })
  await sendAccountSetupEmail({ email: s.email, firstName: s.first_name, studentNumber: s.student_number, setupToken: account.setupToken, sentBy: req.user.id })
  await audit(req, 'student.account_create', 'student', sid)
  res.json({ ok: true })
})

students.post('/:id/reset-password', async (req, res) => {
  const s = await one('SELECT user_id FROM students WHERE id = $1', [idParam(req)])
  if (!s?.user_id) throw badRequest('This student has no portal account')
  const temp = tempPassword()
  await tx(async (t) => {
    await t.query(
      `UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
      [s.user_id, await hashPassword(temp)],
    )
    await t.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [s.user_id])
  })
  await audit(req, 'student.password_reset', 'student', idParam(req))
  // Shown once to the staff member, who passes it to the student in person.
  res.json({ temporaryPassword: temp })
})

students.post('/:id/account-status', async (req, res) => {
  const { active } = parse(z.object({ active: z.boolean() }), req.body)
  const s = await one('SELECT user_id FROM students WHERE id = $1', [idParam(req)])
  if (!s?.user_id) throw badRequest('This student has no portal account')
  await query('UPDATE users SET is_active = $2, locked_until = NULL, failed_logins = 0 WHERE id = $1', [s.user_id, active])
  if (!active) await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [s.user_id])
  await audit(req, active ? 'student.account_enable' : 'student.account_disable', 'student', idParam(req))
  res.json({ ok: true })
})

// ── Photo & ID card ──────────────────────────────────────────────────────────

students.get('/:id/photo', async (req, res) => {
  const s = await one('SELECT photo_file_id FROM students WHERE id = $1', [idParam(req)])
  if (!s?.photo_file_id) throw notFoundError('No photo')
  await sendFile(res, db, s.photo_file_id)
})

students.post('/:id/photo', upload.single('file'), async (req, res) => {
  const sid = idParam(req)
  await tx(async (t) => {
    const s = await t.one('SELECT photo_file_id FROM students WHERE id = $1', [sid])
    if (!s) throw notFoundError()
    const f = await storeFile(t, req.file, req.user.id, IMAGE_TYPES)
    await t.query('UPDATE students SET photo_file_id = $2 WHERE id = $1', [sid, f.id])
    if (s.photo_file_id) await t.query('DELETE FROM files WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM application_documents WHERE file_id = $1)', [s.photo_file_id])
  })
  res.status(201).json({ ok: true })
})

students.get('/:id/id-card.pdf', async (req, res) => {
  const s = await one(
    `SELECT s.*, p.name AS programme_name, c.name AS cohort_name FROM students s
       LEFT JOIN programmes p ON p.id = s.programme_id LEFT JOIN cohorts c ON c.id = s.cohort_id WHERE s.id = $1`,
    [idParam(req)],
  )
  if (!s) throw notFoundError()
  const photo = s.photo_file_id ? (await one('SELECT data FROM files WHERE id = $1', [s.photo_file_id]))?.data : null
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="id-card-${s.student_number.replace(/\//g, '-')}.pdf"`)
  res.send(await idCardPdf({ student: s, photo }))
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

students.post('/import', upload.single('file'), async (req, res) => {
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

  const programmes = await many('SELECT id, slug, lower(name) AS name FROM programmes')
  const cohorts = await many('SELECT id, programme_id, lower(name) AS name FROM cohorts')
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
    const prog = row.programme ? programmes.find((p) => p.slug === row.programme.toLowerCase() || p.name === row.programme.toLowerCase()) : null
    if (row.programme && !prog) { errors.push({ line, error: `Unknown programme "${row.programme}"` }); continue }
    const cohort = row.cohort ? cohorts.find((c) => c.name === row.cohort.toLowerCase() && (!prog || c.programme_id === prog.id)) : null
    if (row.cohort && !cohort) { errors.push({ line, error: `Unknown cohort "${row.cohort}"` }); continue }
    if (row.email) {
      if (seenEmails.has(row.email)) { errors.push({ line, error: `Duplicate email ${row.email} in file` }); continue }
      seenEmails.add(row.email)
    }
    valid.push({ line, ...row, programmeId: prog?.id ?? cohort?.programme_id ?? null, cohortId: cohort?.id ?? null })
  }

  // Duplicates against existing records.
  const emails = valid.filter((v) => v.email).map((v) => v.email)
  const existing = emails.length ? await many(`SELECT lower(email) AS email FROM students WHERE lower(email) = ANY($1)`, [emails]) : []
  const existingSet = new Set(existing.map((e) => e.email))
  const numbers = valid.filter((v) => v.student_number).map((v) => v.student_number.toUpperCase())
  const existingNums = numbers.length ? new Set((await many(`SELECT upper(student_number) AS n FROM students WHERE upper(student_number) = ANY($1)`, [numbers])).map((r) => r.n)) : new Set()
  const toInsert = valid.filter((v) => {
    if (v.email && existingSet.has(v.email)) { errors.push({ line: v.line, error: `A student with email ${v.email} already exists` }); return false }
    if (v.student_number && existingNums.has(v.student_number.toUpperCase())) { errors.push({ line: v.line, error: `Student ID ${v.student_number} already exists` }); return false }
    return true
  })
  errors.sort((a, b) => a.line - b.line)

  if (dryRun || errors.length) {
    return res.json({ dryRun: true, total: records.length, valid: toInsert.length, errors, imported: 0 })
  }

  const created = await tx(async (t) => {
    const out = []
    for (const v of toInsert) {
      const account = createAccounts && v.email ? await ensureStudentAccount(t, { email: v.email, fullName: `${v.first_name} ${v.last_name}`, phone: v.phone }) : null
      const s = await t.one(
        `INSERT INTO students (user_id, student_number, first_name, last_name, email, phone, gender, date_of_birth, guardian_name, guardian_phone, programme_id, cohort_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, student_number, first_name, email`,
        [account?.user.id ?? null, v.student_number || (await nextStudentNumber(t)), v.first_name, v.last_name, v.email ?? null, v.phone, v.gender,
          v.date_of_birth ?? null, v.guardian_name, v.guardian_phone, v.programmeId, v.cohortId],
      )
      out.push({ ...s, setupToken: account?.setupToken })
    }
    await audit(req, 'students.import', 'student', null, { count: out.length }, t)
    return out
  })
  for (const s of created) {
    if (s.setupToken) sendAccountSetupEmail({ email: s.email, firstName: s.first_name, studentNumber: s.student_number, setupToken: s.setupToken, sentBy: req.user.id })
  }
  res.json({ dryRun: false, total: records.length, valid: created.length, errors: [], imported: created.length })
})

