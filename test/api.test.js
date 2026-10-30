// End-to-end API test. Runs the real API handlers against a throwaway MongoDB replica set
// (mongodb-memory-server) with local file storage — no server or external services needed.
// Covers signup → application → admission → enrolment → results → payments → certificates → verification.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

let replSet
let handleApi
let models
const workDir = mkdtempSync(path.join(tmpdir(), 'cca-test-'))
const run = Date.now().toString(36)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')

// Calls the API in-process with a real Fetch Request, following same-site redirects (file downloads).
async function call(path, { token, method = 'GET', body, form, raw, headers: extra = {} } = {}, hops = 0) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }
  if (body) headers['Content-Type'] = 'application/json'
  const url = path.startsWith('/api/') ? `http://test.local${path}` : `http://test.local/api${path}`
  const res = await handleApi(new Request(url, { method, headers, body: raw ?? form ?? (body ? JSON.stringify(body) : undefined) }))
  if ([301, 302, 307].includes(res.status) && hops < 2) return call(res.headers.get('location'), { token }, hops + 1)
  const type = res.headers.get('content-type') ?? ''
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
  return { status: res.status, data, type }
}

const fileForm = (buf, name, type, extra = {}) => {
  const f = new FormData()
  f.append('file', new Blob([buf], { type }), name)
  for (const [k, v] of Object.entries(extra)) f.append(k, v)
  return f
}

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  Object.assign(process.env, {
    MONGODB_URI: replSet.getUri('cca_test'),
    JWT_SECRET: 'test-secret-0123456789abcdef',
    STORAGE_DRIVER: 'local',
    SITE_URL: 'http://test.local',
    SEED_ADMIN_EMAIL: 'admin@chefsculinary.com',
    SEED_ADMIN_PASSWORD: 'AdminPass#2026',
    LOCAL_UPLOAD_DIR: path.join(workDir, 'uploads'),
  })
  ;({ handleApi } = await import('../src/server/api.js'))
  models = await import('../src/server/db/models.js')
  const { seed } = await import('../src/server/db/seed.js')
  await seed({ log: () => {} })
})

after(async () => {
  await mongoose.disconnect()
  await replSet?.stop()
  rmSync(workDir, { recursive: true, force: true })
})

const state = {}

test('applicant signs up and saves a draft', async () => {
  const bad = await call('/auth/signup', { method: 'POST', body: { fullName: 'X', email: 'nope', phone: '1', password: 'short', consent: true } })
  assert.equal(bad.status, 400)
  assert.ok(bad.data.details.email && bad.data.details.password)

  const r = await call('/auth/signup', { method: 'POST', body: { fullName: 'Tunde Bello', email: `tunde.${run}@example.com`, phone: '08031234567', password: 'Chef12345', consent: true } })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  state.applicantToken = r.data.token
  assert.equal(r.data.user.role, 'applicant')

  const dup = await call('/auth/signup', { method: 'POST', body: { fullName: 'Tunde Bello', email: `TUNDE.${run}@example.com`, phone: '08031234567', password: 'Chef12345', consent: true } })
  assert.equal(dup.status, 409)

  const draft = await call('/applications/current', {
    token: state.applicantToken, method: 'PUT',
    body: { programme: 'african-and-asian-cuisine', step: 1, personal: { fullName: 'Tunde Bello', dob: '2000-02-02', phone: '08031234567', state: 'Rivers', city: 'Port Harcourt' }, guardian: { name: 'Mrs Bello', phone: '08030000000' }, background: { education: 'Secondary / SSCE', experience: 'Home cook' } },
  })
  assert.equal(draft.status, 200, JSON.stringify(draft.data))
  assert.equal(draft.data.status, 'draft')
  state.reference = draft.data.reference
})

test('submission requires documents, then succeeds', async () => {
  const early = await call('/applications/current/submit', { token: state.applicantToken, method: 'POST', body: { consent: true } })
  assert.equal(early.status, 400)
  assert.ok(early.data.details.photo)

  const wrongType = await call('/applications/current/documents/photo', { token: state.applicantToken, method: 'POST', form: fileForm(PDF, 'p.pdf', 'application/pdf') })
  assert.equal(wrongType.status, 400, 'photo must be an image')
  const photo = await call('/applications/current/documents/photo', { token: state.applicantToken, method: 'POST', form: fileForm(PNG, 'me.png', 'image/png') })
  assert.equal(photo.status, 201, JSON.stringify(photo.data))
  const idDoc = await call('/applications/current/documents/idDoc', { token: state.applicantToken, method: 'POST', form: fileForm(PDF, 'id.pdf', 'application/pdf') })
  assert.equal(idDoc.status, 201)

  const ok = await call('/applications/current/submit', { token: state.applicantToken, method: 'POST', body: { consent: true } })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  assert.equal(ok.data.status, 'received')
  assert.equal(ok.data.reference, state.reference)

  const again = await call('/applications/current/submit', { token: state.applicantToken, method: 'POST', body: { consent: true } })
  assert.equal(again.status, 400)

  const portal = await call('/student/dashboard', { token: state.applicantToken })
  assert.equal(portal.status, 403, 'applicants cannot open the student area')
})

test('admin signs in; students cannot use the admin portal', async () => {
  const wrongPortal = await call('/auth/login', { method: 'POST', body: { identifier: `tunde.${run}@example.com`, password: 'Chef12345', portal: 'admin' } })
  assert.equal(wrongPortal.status, 403)
  const r = await call('/auth/login', { method: 'POST', body: { identifier: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD, portal: 'admin' } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  state.adminToken = r.data.token
  const noAuth = await call('/admin/dashboard')
  assert.equal(noAuth.status, 401)
  const asApplicant = await call('/admin/dashboard', { token: state.applicantToken })
  assert.equal(asApplicant.status, 403)
  const dash = await call('/admin/dashboard', { token: state.adminToken })
  assert.equal(dash.status, 200)
  assert.ok(dash.data.counts.applications_pending >= 1)
})

test('admin creates a cohort, admits and enrols the applicant', async () => {
  const lookups = await call('/admin/lookups', { token: state.adminToken })
  const prog = lookups.data.programmes.find((p) => p.slug === 'african-and-asian-cuisine')
  const cohort = await call('/admin/cohorts', { token: state.adminToken, method: 'POST', body: { programmeId: prog.id, name: `Test cohort ${run}`, startsOn: '2026-01-05', endsOn: '2026-04-30', schedule: 'Mon, Wed, Fri', feeKobo: 30000000 } })
  assert.equal(cohort.status, 201, JSON.stringify(cohort.data))
  state.cohortId = cohort.data.id
  state.programmeId = prog.id

  const list = await call(`/admin/applications?q=${state.reference}`, { token: state.adminToken })
  const app = list.data.items[0]
  assert.equal(app.reference, state.reference)
  state.applicationId = app.id

  const detail = await call(`/admin/applications/${app.id}`, { token: state.adminToken })
  assert.ok(detail.data.documents.photo)
  const doc = await call(`/admin/applications/${app.id}/documents/${detail.data.documents.photo.id}`, { token: state.adminToken })
  assert.equal(doc.status, 200)
  assert.equal(doc.type, 'image/png')

  const note = await call(`/admin/applications/${app.id}/notes`, { token: state.adminToken, method: 'POST', body: { body: 'Called applicant — strong interest.' } })
  assert.equal(note.status, 201)

  const admit = await call(`/admin/applications/${app.id}/admit`, { token: state.adminToken, method: 'POST', body: { cohortId: state.cohortId, enrol: true } })
  assert.equal(admit.status, 200, JSON.stringify(admit.data))
  assert.equal(admit.data.status, 'enrolled')

  const letter = await call(`/admin/applications/${app.id}/admission-letter.pdf`, { token: state.adminToken })
  assert.equal(letter.type, 'application/pdf')
  assert.equal(letter.data.subarray(0, 5).toString(), '%PDF-')

  const again = await call(`/admin/applications/${app.id}/enrol`, { token: state.adminToken, method: 'POST', body: {} })
  assert.equal(again.status, 400)
})

test('student signs in with student ID and sees their portal', async () => {
  const me = await call('/auth/me', { token: state.applicantToken })
  assert.equal(me.data.user.role, 'student')
  state.studentNumber = me.data.student.student_number
  assert.match(state.studentNumber, /^CCA\/\d{4}\/\d{4}$/)

  const r = await call('/auth/login', { method: 'POST', body: { identifier: state.studentNumber.toLowerCase(), password: 'Chef12345' } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  state.studentToken = r.data.token

  const dash = await call('/student/dashboard', { token: state.studentToken })
  assert.equal(dash.status, 200)
  assert.equal(dash.data.student.cohort, `Test cohort ${run}`)
  assert.equal(dash.data.account.balanceKobo, 30000000, 'cohort fee raised as tuition')

  const pay = await call('/student/payments', { token: state.studentToken })
  assert.equal(pay.data.schedule.length >= 1, true)
})

test('results: draft hidden, validation, publish, correction audit, slip + verification', async () => {
  const lookups = await call('/admin/lookups', { token: state.adminToken })
  const course = lookups.data.courses.find((c) => c.slug === 'food-production')
  state.courseId = course.id
  const studentId = String((await models.Student.findOne({ student_number: state.studentNumber }).lean())._id)
  state.studentId = studentId

  const sheet = await call(`/admin/results/sheet?cohortId=${state.cohortId}&courseId=${course.id}`, { token: state.adminToken })
  assert.equal(sheet.data.rows.length, 1)

  const tooHigh = await call('/admin/results/sheet', { token: state.adminToken, method: 'PUT', body: { cohortId: state.cohortId, courseId: course.id, rows: [{ studentId, scores: { knifeSkills: 25 } }] } })
  assert.equal(tooHigh.status, 400)

  const save = await call('/admin/results/sheet', { token: state.adminToken, method: 'PUT', body: { cohortId: state.cohortId, courseId: course.id, rows: [{ studentId, scores: { knifeSkills: 18, recipeExecution: 36, safetySanitation: 9, theory: 27 } }] } })
  assert.equal(save.status, 200, JSON.stringify(save.data))

  let mine = await call('/student/results', { token: state.studentToken })
  assert.equal(mine.data.terms.find((t) => t.cohortId === state.cohortId)?.rows.length ?? 0, 0, 'draft results are hidden')

  const pub = await call('/admin/results/publish', { token: state.adminToken, method: 'POST', body: { cohortId: state.cohortId, courseId: course.id } })
  assert.equal(pub.data.updated, 1)
  mine = await call('/student/results', { token: state.studentToken })
  const row = mine.data.terms.find((t) => t.cohortId === state.cohortId).rows[0]
  assert.equal(row.total, 90)
  assert.equal(row.grade, 'A')
  assert.equal(row.practical, 63)

  const noReason = await call('/admin/results/sheet', { token: state.adminToken, method: 'PUT', body: { cohortId: state.cohortId, courseId: course.id, rows: [{ studentId, scores: { knifeSkills: 15, recipeExecution: 36, safetySanitation: 9, theory: 27 } }] } })
  assert.equal(noReason.status, 400)
  const fix = await call('/admin/results/sheet', { token: state.adminToken, method: 'PUT', body: { cohortId: state.cohortId, courseId: course.id, reason: 'Transcription error', rows: [{ studentId, scores: { knifeSkills: 15, recipeExecution: 36, safetySanitation: 9, theory: 27 } }] } })
  assert.equal(fix.data.corrected, 1)
  const corrections = await call(`/admin/results/corrections?cohortId=${state.cohortId}`, { token: state.adminToken })
  assert.equal(corrections.data[0].reason, 'Transcription error')

  const slip = await call(`/student/results/${state.cohortId}/slip.pdf`, { token: state.studentToken })
  assert.equal(slip.type, 'application/pdf')
  const code = (await models.DocumentVerification.findOne({ student_id: studentId }).sort({ created_at: -1 }).lean()).code
  const verify = await call(`/public/verify/${code}`)
  assert.equal(verify.data.valid, true)
  assert.equal(verify.data.studentNumber, state.studentNumber)

  const analytics = await call(`/admin/results/analytics?cohortId=${state.cohortId}`, { token: state.adminToken })
  assert.equal(analytics.data.byCourse[0].entries, 1)
})

test('results can be withheld while fees are owed', async () => {
  await call('/admin/settings/results', { token: state.adminToken, method: 'PUT', body: { withholdIfOwing: true, showPositions: true } })
  const withheld = await call('/student/results', { token: state.studentToken })
  assert.equal(withheld.data.withheld, true)
  await call('/admin/settings/results', { token: state.adminToken, method: 'PUT', body: { withholdIfOwing: false, showPositions: false } })
})

test('finance: manual payment, receipt, balance, debtors, report, refund', async () => {
  const form = new FormData()
  form.append('studentId', String(state.studentId))
  form.append('amountKobo', '10000000')
  form.append('method', 'bank_deposit')
  form.append('purpose', 'Tuition deposit')
  form.append('proof', new Blob([PNG], { type: 'image/png' }), 'teller.png')
  const pay = await call('/admin/finance/payments', { token: state.adminToken, method: 'POST', form })
  assert.equal(pay.status, 201, JSON.stringify(pay.data))
  assert.match(pay.data.receipt_number, /^RCT-/)

  const mine = await call('/student/payments', { token: state.studentToken })
  assert.equal(mine.data.account.balanceKobo, 20000000)
  const receipt = await call(`/student/payments/${pay.data.id}/receipt.pdf`, { token: state.studentToken })
  assert.equal(receipt.type, 'application/pdf')

  const disc = await call('/admin/finance/invoices', { token: state.adminToken, method: 'POST', body: { studentId: state.studentId, description: 'Merit scholarship', kind: 'scholarship', category: 'tuition', amountKobo: 5000000 } })
  assert.equal(disc.status, 201)
  const acct = await call(`/admin/finance/students/${state.studentId}`, { token: state.adminToken })
  assert.equal(acct.data.account.balanceKobo, 15000000)

  const debtors = await call(`/admin/finance/debtors?cohortId=${state.cohortId}`, { token: state.adminToken })
  assert.equal(debtors.data.rows[0].balance_kobo, 15000000)
  const today = new Date().toISOString().slice(0, 10)
  const report = await call(`/admin/finance/report?from=2020-01-01&to=${today}&groupBy=method`, { token: state.adminToken })
  assert.ok(report.data.rows.some((r) => r.label === 'bank_deposit'))

  const refund = await call(`/admin/finance/payments/${pay.data.id}/refund`, { token: state.adminToken, method: 'POST', body: { reason: 'Duplicate deposit' } })
  assert.equal(refund.data.status, 'refunded')
  const after = await call('/student/payments', { token: state.studentToken })
  assert.equal(after.data.account.balanceKobo, 25000000)

  const online = await call('/student/payments/initialize', { token: state.studentToken, method: 'POST', body: { amountKobo: 1000000 } })
  assert.equal(online.status, 503, 'online payments disabled without a Paystack key')
})

test('attendance, timetable, materials, assignments, requests, feedback', async () => {
  const today = new Date().toISOString().slice(0, 10)
  const att = await call('/admin/attendance/sheet', { token: state.adminToken, method: 'PUT', body: { cohortId: state.cohortId, date: today, records: [{ studentId: state.studentId, status: 'present' }] } })
  assert.equal(att.data.saved, 1)
  const tt = await call('/admin/timetable', { token: state.adminToken, method: 'POST', body: { cohortId: state.cohortId, dayOfWeek: 1, startTime: '09:00', endTime: '12:00', title: 'Practical kitchen', courseId: state.courseId } })
  assert.equal(tt.status, 201)
  const clash = await call('/admin/timetable', { token: state.adminToken, method: 'POST', body: { cohortId: state.cohortId, dayOfWeek: 1, startTime: '11:00', endTime: '13:00', title: 'Overlap' } })
  assert.equal(clash.status, 400)

  const mat = await call('/admin/materials', { token: state.adminToken, method: 'POST', form: fileForm(PDF, 'handbook.pdf', 'application/pdf', { title: 'Student handbook', cohortId: String(state.cohortId) }) })
  assert.equal(mat.status, 201, JSON.stringify(mat.data))
  const mats = await call('/student/materials', { token: state.studentToken })
  assert.ok(mats.data.some((m) => m.title === 'Student handbook'))
  const dl = await call(`/student/materials/${mat.data.id}/download`, { token: state.studentToken })
  assert.equal(dl.status, 200)

  const asg = await call('/admin/assignments', { token: state.adminToken, method: 'POST', body: { cohortId: state.cohortId, title: 'Jollof plating', dueAt: new Date(Date.now() + 86_400_000).toISOString() } })
  assert.equal(asg.status, 201, JSON.stringify(asg.data))
  const sub = await call(`/student/assignments/${asg.data.id}/submit`, { token: state.studentToken, method: 'POST', form: fileForm(PNG, 'plate.png', 'image/png', { note: 'My plate' }) })
  assert.equal(sub.status, 201, JSON.stringify(sub.data))

  const req = await call('/student/requests', { token: state.studentToken, method: 'POST', body: { type: 'transcript', details: 'For a job application' } })
  assert.equal(req.status, 201)
  const fb = await call('/student/feedback', { token: state.studentToken, method: 'POST', body: { courseId: state.courseId, rating: 5, comments: 'Great' } })
  assert.equal(fb.status, 201)

  const dash = await call('/student/dashboard', { token: state.studentToken })
  assert.equal(dash.data.attendance.rate, 100)
  assert.ok(dash.data.nextClass)
})

test('course outlines: admin uploads, student downloads only their own', async () => {
  const none = await call('/student/course-outline', { token: state.studentToken })
  assert.equal(none.status, 200)
  assert.ok(none.data.courses.length > 0)

  const wrong = await call(`/admin/courses/${state.courseId}/outline`, { token: state.adminToken, method: 'POST', form: fileForm(Buffer.from('not a real file'), 'x.exe', 'application/octet-stream') })
  assert.equal(wrong.status, 400, 'unsupported file types are rejected')
  const up = await call(`/admin/courses/${state.courseId}/outline`, { token: state.adminToken, method: 'POST', form: fileForm(PDF, 'food-production-outline.pdf', 'application/pdf') })
  assert.equal(up.status, 201, JSON.stringify(up.data))
  const prog = await call(`/admin/programmes/${state.programmeId}/outline`, { token: state.adminToken, method: 'POST', form: fileForm(PDF, 'programme-outline.pdf', 'application/pdf') })
  assert.equal(prog.status, 201)

  const list = await call('/student/course-outline', { token: state.studentToken })
  assert.equal(list.data.programme.outline.filename, 'programme-outline.pdf')
  assert.equal(list.data.courses.find((c) => c.id === state.courseId).outline.filename, 'food-production-outline.pdf')
  const dl = await call(`/student/course-outline/courses/${state.courseId}/download`, { token: state.studentToken })
  assert.equal(dl.status, 200)
  assert.equal(dl.data.subarray(0, 5).toString(), '%PDF-')
  const pdl = await call('/student/course-outline/programme/download', { token: state.studentToken })
  assert.equal(pdl.status, 200)

  // A course outside the student's programme is not downloadable.
  const programmeDoc = await models.Programme.findById(state.programmeId).lean()
  const other = await models.Course.findOne({ _id: { $nin: programmeDoc.course_ids } }).lean()
  if (other) {
    const blocked = await call(`/student/course-outline/courses/${other._id}/download`, { token: state.studentToken })
    assert.equal(blocked.status, 404)
  }
  const anon = await call('/student/course-outline')
  assert.equal(anon.status, 401)

  const removed = await call(`/admin/courses/${state.courseId}/outline`, { token: state.adminToken, method: 'DELETE' })
  assert.equal(removed.status, 200)
  const after = await call(`/student/course-outline/courses/${state.courseId}/download`, { token: state.studentToken })
  assert.equal(after.status, 404)
})

test('direct uploads: signed upload, type check, attach, download', async () => {
  // A file claiming to be a PDF but containing something else is rejected at the "complete" step.
  const fake = await call('/uploads', { token: state.adminToken, method: 'POST', body: { filename: 'notes.pdf', contentType: 'application/pdf', size: 11, purpose: 'material' } })
  assert.equal(fake.status, 201, JSON.stringify(fake.data))
  await call(fake.data.uploadUrl, { method: 'PUT', raw: Buffer.from('hello world'), headers: { 'Content-Type': 'application/pdf' } })
  const rejected = await call(`/uploads/${fake.data.fileId}/complete`, { token: state.adminToken, method: 'POST' })
  assert.equal(rejected.status, 400)

  const tooBig = await call('/uploads', { token: state.adminToken, method: 'POST', body: { filename: 'big.pdf', contentType: 'application/pdf', size: 50 * 1024 * 1024, purpose: 'material' } })
  assert.equal(tooBig.status, 400)
  const notAllowed = await call('/uploads', { token: state.studentToken, method: 'POST', body: { filename: 'x.pdf', contentType: 'application/pdf', size: 10, purpose: 'material' } })
  assert.equal(notAllowed.status, 403, 'students cannot upload staff materials')

  const up = await call('/uploads', { token: state.adminToken, method: 'POST', body: { filename: 'recipes.pdf', contentType: 'application/pdf', size: PDF.length, purpose: 'material' } })
  const put = await call(up.data.uploadUrl, { method: 'PUT', raw: PDF, headers: { 'Content-Type': 'application/pdf' } })
  assert.equal(put.status, 200)
  const done = await call(`/uploads/${up.data.fileId}/complete`, { token: state.adminToken, method: 'POST' })
  assert.equal(done.status, 200, JSON.stringify(done.data))
  assert.equal(done.data.type, 'application/pdf')

  const mat = await call('/admin/materials', { token: state.adminToken, method: 'POST', body: { title: 'Recipe book', cohortId: state.cohortId, fileId: up.data.fileId } })
  assert.equal(mat.status, 201, JSON.stringify(mat.data))
  const dl = await call(`/student/materials/${mat.data.id}/download`, { token: state.studentToken })
  assert.equal(dl.status, 200)
  assert.equal(dl.data.subarray(0, 5).toString(), '%PDF-')

  // Someone else can't attach another user's upload.
  const theirs = await call('/uploads', { token: state.studentToken, method: 'POST', body: { filename: 'me.png', contentType: 'image/png', size: PNG.length, purpose: 'profile_photo' } })
  await call(theirs.data.uploadUrl, { method: 'PUT', raw: PNG, headers: { 'Content-Type': 'image/png' } })
  await call(`/uploads/${theirs.data.fileId}/complete`, { token: state.studentToken, method: 'POST' })
  const stolen = await call(`/admin/students/${state.studentId}/photo`, { token: state.adminToken, method: 'POST', body: { fileId: theirs.data.fileId } })
  assert.equal(stolen.status, 403)
  const own = await call('/student/profile/photo', { token: state.studentToken, method: 'POST', body: { fileId: theirs.data.fileId } })
  assert.equal(own.status, 201)
})

test('website gallery: built-in photos, admin upload, hide, reorder, delete', async () => {
  const initial = await call('/public/gallery')
  assert.equal(initial.status, 200)
  assert.ok(initial.data.length >= 10, 'bundled photos are copied in on first use')

  const notAllowed = await call('/uploads', { token: state.studentToken, method: 'POST', body: { filename: 'x.png', contentType: 'image/png', size: PNG.length, purpose: 'gallery_photo' } })
  assert.equal(notAllowed.status, 403, 'students cannot upload gallery photos')
  const pdf = await call('/uploads', { token: state.adminToken, method: 'POST', body: { filename: 'x.pdf', contentType: 'application/pdf', size: PDF.length, purpose: 'gallery_photo' } })
  assert.equal(pdf.status, 400, 'gallery takes images only')

  const up = await call('/uploads', { token: state.adminToken, method: 'POST', body: { filename: 'plating.png', contentType: 'image/png', size: PNG.length, purpose: 'gallery_photo' } })
  await call(up.data.uploadUrl, { method: 'PUT', raw: PNG, headers: { 'Content-Type': 'image/png' } })
  await call(`/uploads/${up.data.fileId}/complete`, { token: state.adminToken, method: 'POST' })
  const added = await call('/admin/gallery', { token: state.adminToken, method: 'POST', body: { fileId: up.data.fileId, caption: 'Plating class', category: 'dishes' } })
  assert.equal(added.status, 201, JSON.stringify(added.data))

  const pub = await call('/public/gallery')
  assert.equal(pub.data[0].id, added.data.id, 'new photos go first')
  assert.equal(pub.data[0].caption, 'Plating class')
  const img = await call(pub.data[0].src)
  assert.equal(img.status, 200)
  assert.ok(img.data.equals(PNG), 'the image link serves the uploaded file')

  await call(`/admin/gallery/${added.data.id}/move`, { token: state.adminToken, method: 'POST', body: { direction: 'down' } })
  assert.equal((await call('/public/gallery')).data[1].id, added.data.id)

  const hidden = await call(`/admin/gallery/${added.data.id}`, { token: state.adminToken, method: 'PATCH', body: { isPublished: false } })
  assert.equal(hidden.data.caption, 'Plating class', 'hiding keeps the caption')
  assert.ok(!(await call('/public/gallery')).data.some((p) => p.id === added.data.id), 'hidden photos are not public')
  assert.ok((await call('/admin/gallery', { token: state.adminToken })).data.some((p) => p.id === added.data.id && !p.is_published))

  const del = await call(`/admin/gallery/${added.data.id}`, { token: state.adminToken, method: 'DELETE' })
  assert.equal(del.status, 200)
  assert.equal((await call('/admin/gallery', { token: state.adminToken })).data.length, initial.data.length)
})

test('website gallery: bulk upload, then bulk hide, recategorise and delete', async () => {
  const before = (await call('/admin/gallery', { token: state.adminToken })).data.length
  const ids = []
  for (const name of ['a.png', 'b.png', 'c.png']) {
    const up = await call('/uploads', { token: state.adminToken, method: 'POST', body: { filename: name, contentType: 'image/png', size: PNG.length, purpose: 'gallery_photo' } })
    await call(up.data.uploadUrl, { method: 'PUT', raw: PNG, headers: { 'Content-Type': 'image/png' } })
    await call(`/uploads/${up.data.fileId}/complete`, { token: state.adminToken, method: 'POST' })
    ids.push((await call('/admin/gallery', { token: state.adminToken, method: 'POST', body: { fileId: up.data.fileId, caption: name } })).data.id)
  }

  const bad = await call('/admin/gallery/bulk', { token: state.adminToken, method: 'POST', body: { ids, action: 'category' } })
  assert.equal(bad.status, 400, 'moving needs a category')

  const hide = await call('/admin/gallery/bulk', { token: state.adminToken, method: 'POST', body: { ids: ids.slice(0, 2), action: 'hide' } })
  assert.equal(hide.data.count, 2)
  const pub = (await call('/public/gallery')).data
  assert.ok(!pub.some((p) => ids.slice(0, 2).includes(p.id)) && pub.some((p) => p.id === ids[2]))

  await call('/admin/gallery/bulk', { token: state.adminToken, method: 'POST', body: { ids, action: 'category', category: 'events' } })
  const rows = (await call('/admin/gallery', { token: state.adminToken })).data.filter((p) => ids.includes(p.id))
  assert.ok(rows.every((p) => p.category === 'events'))

  const del = await call('/admin/gallery/bulk', { token: state.adminToken, method: 'POST', body: { ids, action: 'delete' } })
  assert.equal(del.data.count, 3)
  assert.equal((await call('/admin/gallery', { token: state.adminToken })).data.length, before)
})

test('certificates: issue, download, public verification, revoke', async () => {
  const cert = await call('/admin/certificates', { token: state.adminToken, method: 'POST', body: { studentId: state.studentId } })
  assert.equal(cert.status, 201, JSON.stringify(cert.data))
  const pdf = await call(`/student/certificates/${cert.data.id}/pdf`, { token: state.studentToken })
  assert.equal(pdf.type, 'application/pdf')
  const v = await call(`/public/verify/${cert.data.verification_code}`)
  assert.equal(v.data.status, 'valid')
  await call(`/admin/certificates/${cert.data.id}/revoke`, { token: state.adminToken, method: 'POST', body: { reason: 'Issued in error' } })
  const v2 = await call(`/public/verify/${cert.data.serial}`)
  assert.equal(v2.data.status, 'revoked')
})

test('online video courses: upload, preview, one device, payment, access, revoke', async () => {
  const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(12), Buffer.from('rest of the movie')])
  const admin = state.adminToken
  const uploadVideo = async (bytes, name = 'Lesson one.mp4') => {
    const start = await call('/uploads/multipart', { token: admin, method: 'POST', body: { filename: name, contentType: 'video/mp4', size: bytes.length, purpose: 'training_video' } })
    assert.equal(start.status, 201, JSON.stringify(start.data))
    assert.equal(start.data.mode, 'single') // local driver
    await call(start.data.uploadUrl, { method: 'PUT', raw: bytes, headers: { 'Content-Type': 'video/mp4' } })
    return call(`/uploads/multipart/${start.data.fileId}/complete`, { token: admin, method: 'POST', body: { parts: [] } })
  }

  // Videos must use the multipart route, and must really be videos.
  const wrongRoute = await call('/uploads', { token: admin, method: 'POST', body: { filename: 'a.mp4', contentType: 'video/mp4', size: 100, purpose: 'training_video' } })
  assert.equal(wrongRoute.status, 400)
  assert.equal((await uploadVideo(Buffer.from('not a video at all'))).status, 400)
  const notStaff = await call('/uploads/multipart', { token: state.applicantToken, method: 'POST', body: { filename: 'a.mp4', contentType: 'video/mp4', size: 100, purpose: 'training_video' } })
  assert.equal(notStaff.status, 403)

  const course = await call('/admin/videos/courses', { token: admin, method: 'POST', body: { title: 'Small Chops Masterclass', summary: 'Puff-puff to samosa', priceKobo: 2_500_000 } })
  assert.equal(course.status, 201, JSON.stringify(course.data))
  const courseId = course.data.id
  const v1 = await uploadVideo(MP4)
  assert.equal(v1.status, 200, JSON.stringify(v1.data))
  assert.equal(v1.data.type, 'video/mp4')
  const paidLesson = await call(`/admin/videos/courses/${courseId}/lessons`, { token: admin, method: 'POST', body: { title: 'Puff-puff', fileId: v1.data.id } })
  assert.equal(paidLesson.status, 201, JSON.stringify(paidLesson.data))
  const v2 = await uploadVideo(MP4, 'Intro.mp4')
  const preview = await call(`/admin/videos/courses/${courseId}/lessons`, { token: admin, method: 'POST', body: { title: 'Welcome', fileId: v2.data.id, isPreview: true } })
  await call(`/admin/videos/lessons/${preview.data.id}/move`, { token: admin, method: 'POST', body: { direction: 'up' } })
  const detail = await call(`/admin/videos/courses/${courseId}`, { token: admin })
  assert.deepEqual(detail.data.lessons.map((l) => l.title), ['Welcome', 'Puff-puff'])

  // Hidden while a draft, and while scheduled for later; live once published.
  assert.ok(!(await call('/videos/courses')).data.some((c) => c.id === courseId))
  const later = new Date(Date.now() + 86_400_000).toISOString()
  const scheduled = await call(`/admin/videos/courses/${courseId}`, { token: admin, method: 'PATCH', body: { isPublished: true, publishAt: later } })
  assert.equal(scheduled.data.publish_state, 'scheduled')
  assert.ok(!(await call('/videos/courses')).data.some((c) => c.id === courseId))
  assert.equal((await call(`/videos/courses/${course.data.slug}`)).status, 404)
  const live = await call(`/admin/videos/courses/${courseId}`, { token: admin, method: 'PATCH', body: { isPublished: true, publishAt: null } })
  assert.equal(live.data.publish_state, 'published')
  assert.ok(Date.now() - new Date(live.data.publish_at) < 60_000)
  const listed = await call('/videos/courses')
  assert.ok(listed.data.some((c) => c.id === courseId && c.lessons === 2 && c.price_kobo === 2_500_000))

  // A new account can watch only the free preview.
  const buyerEmail = `viewer.${run}@example.com`
  const signup = await call('/auth/signup', { method: 'POST', body: { fullName: 'Ngozi Viewer', email: buyerEmail, phone: '08035550000', password: 'Chef12345', consent: true } })
  const buyer = signup.data.token
  const page = await call(`/videos/courses/${course.data.slug}`, { token: buyer })
  assert.equal(page.data.access, 'preview')
  assert.deepEqual(page.data.lessons.map((l) => l.playable), [true, false])
  assert.equal((await call(`/videos/lessons/${paidLesson.data.id}/play`, { token: buyer, method: 'POST' })).status, 402)
  assert.equal((await call(`/videos/lessons/${preview.data.id}/play`, { method: 'POST' })).status, 401)
  const play = await call(`/videos/lessons/${preview.data.id}/play`, { token: buyer, method: 'POST' })
  assert.equal(play.status, 200, JSON.stringify(play.data))
  const ranged = await handleApi(new Request(`http://test.local${play.data.url}`, { headers: { Range: 'bytes=4-7' } }))
  assert.equal(ranged.status, 206)
  assert.equal(Buffer.from(await ranged.arrayBuffer()).toString(), 'ftyp')

  // One device at a time: a second session is refused until the first lets go.
  const second = await call('/auth/login', { method: 'POST', body: { identifier: buyerEmail, password: 'Chef12345' } })
  assert.equal((await call(`/videos/lessons/${preview.data.id}/play`, { token: second.data.token, method: 'POST' })).status, 409)
  await call('/videos/viewer/release', { token: buyer, method: 'POST' })
  assert.equal((await call(`/videos/lessons/${preview.data.id}/play`, { token: second.data.token, method: 'POST' })).status, 200)
  await call('/videos/viewer/release', { token: second.data.token, method: 'POST' })

  // Online checkout needs Paystack keys.
  assert.equal((await call(`/videos/courses/${courseId}/checkout`, { token: buyer, method: 'POST' })).status, 503)

  // Settlement (as the webhook/verify would do it): a wrong amount is never credited; the right one unlocks the course.
  const { withTransaction } = await import('../src/server/db/mongo.js')
  const { settleVideoOrder } = await import('../src/server/lib/videos.js')
  const buyerUser = await models.User.findOne({ email: buyerEmail }).lean()
  const short = await models.VideoOrder.create({ user_id: buyerUser._id, course_id: courseId, amount_kobo: 2_500_000, reference: `VID-SHORT-${run}` })
  const r1 = await withTransaction((session) => settleVideoOrder(session, short.reference, { status: 'success', amount: 100_000, currency: 'NGN' }))
  assert.equal(r1.order.status, 'failed')
  assert.equal((await call(`/videos/courses/${course.data.slug}`, { token: buyer })).data.access, 'preview')
  const good = await models.VideoOrder.create({ user_id: buyerUser._id, course_id: courseId, amount_kobo: 2_500_000, reference: `VID-GOOD-${run}` })
  const r2 = await withTransaction((session) => settleVideoOrder(session, good.reference, { status: 'success', amount: 2_500_000, currency: 'NGN', channel: 'card' }))
  assert.equal(r2.newlySettled, true)
  const again = await withTransaction((session) => settleVideoOrder(session, good.reference, { status: 'success', amount: 2_500_000, currency: 'NGN' }))
  assert.equal(again.newlySettled, false, 'settling twice is harmless')
  assert.equal((await call(`/videos/courses/${course.data.slug}`, { token: buyer })).data.access, 'full')
  assert.equal((await call(`/videos/lessons/${paidLesson.data.id}/play`, { token: buyer, method: 'POST' })).status, 200)
  const prog = await call(`/videos/lessons/${paidLesson.data.id}/progress`, { token: buyer, method: 'POST', body: { position: 95, duration: 100, playing: false } })
  assert.equal(prog.data.completed, true)

  // Admin sees the learner and payment, and can remove and restore access.
  const learners = await call(`/admin/videos/courses/${courseId}/learners`, { token: admin })
  const row = learners.data.find((l) => l.email === buyerEmail)
  assert.equal(row.source, 'purchase')
  assert.equal(row.completed, 1)
  const orders = await call(`/admin/videos/courses/${courseId}/orders`, { token: admin })
  assert.equal(orders.data.filter((o) => o.status === 'success').length, 1)
  await call(`/admin/videos/enrollments/${row.id}/revoke`, { token: admin, method: 'POST' })
  assert.equal((await call(`/videos/lessons/${paidLesson.data.id}/play`, { token: buyer, method: 'POST' })).status, 402)
  await call(`/admin/videos/enrollments/${row.id}/restore`, { token: admin, method: 'POST' })
  assert.equal((await call(`/videos/lessons/${paidLesson.data.id}/play`, { token: buyer, method: 'POST' })).status, 200)

  // Manual grants need an existing account; paid courses can't be deleted.
  const nobody = await call(`/admin/videos/courses/${courseId}/learners`, { token: admin, method: 'POST', body: { email: 'nobody@example.com' } })
  assert.equal(nobody.status, 400)
  const granted = await call(`/admin/videos/courses/${courseId}/learners`, { token: admin, method: 'POST', body: { email: `tunde.${run}@example.com` } })
  assert.equal(granted.status, 201, JSON.stringify(granted.data))
  assert.equal((await call(`/admin/videos/courses/${courseId}`, { token: admin, method: 'DELETE' })).status, 400)
})

test('account lockout after repeated failures, password reset', async () => {
  const email = `lock.${run}@example.com`
  await call('/auth/signup', { method: 'POST', body: { fullName: 'Lock Test', email, phone: '08030000001', password: 'Chef12345', consent: true } })
  for (let i = 0; i < 5; i++) await call('/auth/login', { method: 'POST', body: { identifier: email, password: 'wrong-pass' } })
  const locked = await call('/auth/login', { method: 'POST', body: { identifier: email, password: 'Chef12345' } })
  assert.equal(locked.status, 423)

  const forgot = await call('/auth/forgot-password', { method: 'POST', body: { identifier: email } })
  assert.equal(forgot.status, 200)
  const bad = await call('/auth/reset-password', { method: 'POST', body: { token: 'x'.repeat(40), password: 'NewPass123' } })
  assert.equal(bad.status, 400)
})

test('audit log records admin actions; logout revokes the session', async () => {
  const log = await call('/admin/audit-log?action=application', { token: state.adminToken })
  assert.ok(log.data.items.some((r) => r.action === 'application.enrol'))
  await call('/auth/logout', { token: state.studentToken, method: 'POST' })
  const after = await call('/auth/me', { token: state.studentToken })
  assert.equal(after.status, 401)
})
