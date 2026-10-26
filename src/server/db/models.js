// MongoDB collections. Field names match the API's JSON (snake_case) so the screens read them unchanged.
// Date-only values (due dates, start dates, attendance dates) are stored as 'YYYY-MM-DD' strings.
import mongoose from 'mongoose'

const { Schema } = mongoose
const Id = Schema.Types.ObjectId
const ts = { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
const created = { timestamps: { createdAt: 'created_at', updatedAt: false } }
const day = { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null }

function model(name, schema) {
  return mongoose.models[name] ?? mongoose.model(name, schema)
}

// ── Users & auth ─────────────────────────────────────────────────────────────

export const User = model('User', new Schema({
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  password_hash: { type: String, required: true },
  role: { type: String, required: true, enum: ['super_admin', 'staff', 'student', 'applicant'] },
  full_name: { type: String, default: '' },
  phone: { type: String, default: null },
  is_active: { type: Boolean, default: true },
  two_factor_enabled: { type: Boolean, default: false },
  must_change_password: { type: Boolean, default: false },
  failed_logins: { type: Number, default: 0 },
  locked_until: { type: Date, default: null },
  last_login_at: { type: Date, default: null },
  password_changed_at: { type: Date, default: null },
}, ts))

const sessionSchema = new Schema({
  user_id: { type: Id, ref: 'User', required: true, index: true },
  token_hash: { type: String, required: true, unique: true },
  user_agent: String,
  ip: String,
  last_seen_at: { type: Date, default: Date.now },
  expires_at: { type: Date, required: true },
  revoked_at: { type: Date, default: null },
}, created)
sessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 7 * 86400 }) // purge a week after expiry
export const Session = model('Session', sessionSchema)

const authTokenSchema = new Schema({
  user_id: { type: Id, ref: 'User', required: true },
  purpose: { type: String, required: true, enum: ['password_reset', 'login_otp'] },
  token_hash: { type: String, required: true },
  code_hash: String,
  attempts: { type: Number, default: 0 },
  expires_at: { type: Date, required: true },
  used_at: { type: Date, default: null },
}, created)
authTokenSchema.index({ purpose: 1, token_hash: 1 })
authTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 7 * 86400 })
export const AuthToken = model('AuthToken', authTokenSchema)

// Fixed-window counters for rate limiting, shared by every server instance.
const rateLimitSchema = new Schema({ _id: String, count: Number, expires_at: Date })
rateLimitSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })
export const RateLimit = model('RateLimit', rateLimitSchema)

// Named sequences: student numbers, receipts, certificate serials, sponsor invoices.
export const Counter = model('Counter', new Schema({ _id: String, seq: { type: Number, default: 0 } }))

// Metadata for uploaded files; the bytes live in object storage (S3/R2) under `key`.
export const File = model('File', new Schema({
  key: { type: String, required: true, unique: true },
  filename: { type: String, required: true },
  mime_type: { type: String, required: true },
  size_bytes: { type: Number, required: true },
  purpose: { type: String, required: true },
  status: { type: String, enum: ['pending', 'ready'], default: 'pending' },
  owner_user_id: { type: Id, ref: 'User', default: null },
}, created))

// ── Programmes, courses, grading ─────────────────────────────────────────────

const instalment = new Schema({ label: String, percent: Number, dueWeeks: Number }, { _id: false })

export const Programme = model('Programme', new Schema({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, required: true, enum: ['professional', 'cohort', 'short'] },
  summary: String,
  description: String,
  duration_weeks: Number,
  schedule: String,
  fee_kobo: { type: Number, default: null },
  application_fee_kobo: { type: Number, default: 0 },
  fee_covers: { type: [String], default: [] },
  instalment_plan: { type: [instalment], default: [] },
  intake_dates: String,
  application_deadline: day,
  entry_requirements: String,
  curriculum: String,
  outcomes: String,
  certificate_awarded: String,
  careers: String,
  is_published: { type: Boolean, default: false },
  sort_order: { type: Number, default: 0 },
  course_ids: [{ type: Id, ref: 'Course' }], // ordered
  outline_file_id: { type: Id, ref: 'File', default: null },
}, ts))

export const Course = model('Course', new Schema({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, required: true },
  description: String,
  is_assessed: { type: Boolean, default: true },
  grading_scheme_id: { type: Id, ref: 'GradingScheme', default: null },
  outline_file_id: { type: Id, ref: 'File', default: null },
}, created))

const gradingSchemeSchema = new Schema({
  name: { type: String, required: true },
  definition: { type: Schema.Types.Mixed, required: true }, // { bands: [...], components: [...] }
  is_default: { type: Boolean, default: false },
}, ts)
gradingSchemeSchema.index({ is_default: 1 }, { unique: true, partialFilterExpression: { is_default: true } })
export const GradingScheme = model('GradingScheme', gradingSchemeSchema)

// ── Cohorts & students ───────────────────────────────────────────────────────

export const Cohort = model('Cohort', new Schema({
  programme_id: { type: Id, ref: 'Programme', required: true, index: true },
  name: { type: String, required: true },
  sponsor: String,
  sponsor_email: String,
  starts_on: day,
  ends_on: day,
  schedule: String,
  status: { type: String, enum: ['planned', 'active', 'completed', 'archived'], default: 'active' },
  capacity: Number,
  fee_kobo: { type: Number, default: null },
  rules: String,
  notes: String,
}, created))

const studentSchema = new Schema({
  user_id: { type: Id, ref: 'User', default: null },
  student_number: { type: String, required: true, unique: true },
  first_name: { type: String, required: true },
  last_name: { type: String, required: true },
  email: String,
  phone: String,
  gender: String,
  date_of_birth: day,
  address: String,
  city: String,
  state: String,
  guardian_name: String,
  guardian_phone: String,
  guardian_relationship: String,
  sponsor: String,
  photo_file_id: { type: Id, ref: 'File', default: null },
  programme_id: { type: Id, ref: 'Programme', default: null },
  cohort_id: { type: Id, ref: 'Cohort', default: null },
  application_id: { type: Id, ref: 'Application', default: null },
  status: { type: String, enum: ['active', 'suspended', 'graduated', 'withdrawn', 'archived'], default: 'active' },
  enrolled_on: { ...day, default: () => new Date().toISOString().slice(0, 10) },
  graduated_on: day,
  notes: String,
}, ts)
studentSchema.index({ user_id: 1 }, { unique: true, partialFilterExpression: { user_id: { $type: 'objectId' } } })
studentSchema.index({ cohort_id: 1 })
studentSchema.index({ email: 1 })
export const Student = model('Student', studentSchema)

// ── Admissions ───────────────────────────────────────────────────────────────

const applicationSchema = new Schema({
  user_id: { type: Id, ref: 'User', required: true, index: true },
  reference: { type: String, required: true, unique: true },
  programme_id: { type: Id, ref: 'Programme', default: null },
  cohort_id: { type: Id, ref: 'Cohort', default: null },
  status: { type: String, enum: ['draft', 'received', 'under_review', 'admitted', 'declined', 'waitlisted', 'enrolled'], default: 'draft' },
  current_step: { type: Number, default: 0 },
  data: { type: Schema.Types.Mixed, default: {} }, // personal, guardian, background answers
  documents: [new Schema({ kind: String, file_id: { type: Id, ref: 'File' }, created_at: { type: Date, default: Date.now } }, { _id: false })],
  notes: [new Schema({ author_id: { type: Id, ref: 'User' }, body: String, created_at: { type: Date, default: Date.now } })],
  student_id: { type: Id, ref: 'Student', default: null },
  submitted_at: { type: Date, default: null },
  decided_at: { type: Date, default: null },
  decided_by: { type: Id, ref: 'User', default: null },
}, ts)
applicationSchema.index({ status: 1 })
export const Application = model('Application', applicationSchema)

// ── Results ──────────────────────────────────────────────────────────────────

const resultSchema = new Schema({
  student_id: { type: Id, ref: 'Student', required: true },
  course_id: { type: Id, ref: 'Course', required: true },
  cohort_id: { type: Id, ref: 'Cohort', required: true },
  scores: { type: Schema.Types.Mixed, required: true },
  total: { type: Number, required: true },
  grade: { type: String, required: true },
  remark: String,
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  published_at: { type: Date, default: null },
  grading_scheme_id: { type: Id, ref: 'GradingScheme', default: null },
  entered_by: { type: Id, ref: 'User', default: null },
}, { ...ts, minimize: false })
resultSchema.index({ student_id: 1, course_id: 1, cohort_id: 1 }, { unique: true })
resultSchema.index({ cohort_id: 1, course_id: 1 })
export const Result = model('Result', resultSchema)

export const ResultCorrection = model('ResultCorrection', new Schema({
  result_id: { type: Id, ref: 'Result', required: true, index: true },
  changed_by: { type: Id, ref: 'User', default: null },
  reason: { type: String, required: true },
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
}, created))

// Verification codes printed on result slips (certificates carry their own code).
export const DocumentVerification = model('DocumentVerification', new Schema({
  code: { type: String, required: true, unique: true },
  kind: { type: String, required: true },
  student_id: { type: Id, ref: 'Student', required: true, index: true },
  cohort_id: { type: Id, ref: 'Cohort', default: null },
  snapshot_key: String, // stable JSON of the snapshot, to reuse codes while results are unchanged
  snapshot: Schema.Types.Mixed,
}, created))

// ── Finance ──────────────────────────────────────────────────────────────────

const CATEGORIES = ['tuition', 'application', 'registration', 'materials', 'uniform', 'project', 'short_course', 'event', 'certificate', 'other']

const invoiceSchema = new Schema({
  student_id: { type: Id, ref: 'Student', required: true, index: true },
  cohort_id: { type: Id, ref: 'Cohort', default: null },
  description: { type: String, required: true },
  category: { type: String, enum: CATEGORIES, default: 'tuition' },
  kind: { type: String, enum: ['charge', 'discount', 'scholarship', 'sponsor'], default: 'charge' },
  amount_kobo: { type: Number, required: true, min: 1 },
  due_date: day,
  created_by: { type: Id, ref: 'User', default: null },
  voided_at: { type: Date, default: null },
  void_reason: String,
}, created)
export const Invoice = model('Invoice', invoiceSchema)

const paymentSchema = new Schema({
  student_id: { type: Id, ref: 'Student', required: true, index: true },
  invoice_id: { type: Id, ref: 'Invoice', default: null },
  amount_kobo: { type: Number, required: true, min: 1 },
  purpose: { type: String, required: true },
  method: { type: String, required: true },
  reference: { type: String, default: null },
  status: { type: String, enum: ['pending', 'success', 'failed', 'refunded', 'cancelled'], default: 'pending' },
  paid_at: { type: Date, default: null },
  receipt_number: { type: String, default: null },
  gateway: String,
  gateway_response: Schema.Types.Mixed,
  proof_file_id: { type: Id, ref: 'File', default: null },
  recorded_by: { type: Id, ref: 'User', default: null },
  notes: String,
  refunded_at: { type: Date, default: null },
  refund_reason: String,
}, created)
paymentSchema.index({ reference: 1 }, { unique: true, partialFilterExpression: { reference: { $type: 'string' } } })
paymentSchema.index({ receipt_number: 1 }, { unique: true, partialFilterExpression: { receipt_number: { $type: 'string' } } })
paymentSchema.index({ paid_at: -1 })
export const Payment = model('Payment', paymentSchema)

export const SponsorInvoice = model('SponsorInvoice', new Schema({
  invoice_number: { type: String, required: true, unique: true },
  cohort_id: { type: Id, ref: 'Cohort', default: null },
  sponsor_name: { type: String, required: true },
  sponsor_email: String,
  description: { type: String, required: true },
  amount_kobo: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['unpaid', 'paid', 'cancelled'], default: 'unpaid' },
  issued_on: { ...day, default: () => new Date().toISOString().slice(0, 10) },
  due_date: day,
  paid_on: day,
  created_by: { type: Id, ref: 'User', default: null },
}, created))

// ── Academic services ────────────────────────────────────────────────────────

const attendanceSchema = new Schema({
  cohort_id: { type: Id, ref: 'Cohort', required: true },
  student_id: { type: Id, ref: 'Student', required: true },
  date: { ...day, required: true },
  status: { type: String, required: true, enum: ['present', 'absent', 'late', 'excused'] },
  marked_by: { type: Id, ref: 'User', default: null },
}, { timestamps: { createdAt: false, updatedAt: 'updated_at' } })
attendanceSchema.index({ cohort_id: 1, student_id: 1, date: 1 }, { unique: true })
export const Attendance = model('Attendance', attendanceSchema)

export const TimetableEntry = model('TimetableEntry', new Schema({
  cohort_id: { type: Id, ref: 'Cohort', required: true, index: true },
  day_of_week: { type: Number, required: true, min: 1, max: 7 }, // 1 = Monday
  start_time: { type: String, required: true }, // 'HH:MM'
  end_time: { type: String, required: true },
  title: { type: String, required: true },
  course_id: { type: Id, ref: 'Course', default: null },
  instructor: String,
  venue: String,
}))

export const Material = model('Material', new Schema({
  title: { type: String, required: true },
  description: String,
  programme_id: { type: Id, ref: 'Programme', default: null },
  cohort_id: { type: Id, ref: 'Cohort', default: null },
  course_id: { type: Id, ref: 'Course', default: null },
  file_id: { type: Id, ref: 'File', default: null },
  url: String,
  is_published: { type: Boolean, default: true },
  created_by: { type: Id, ref: 'User', default: null },
}, created))

export const Assignment = model('Assignment', new Schema({
  cohort_id: { type: Id, ref: 'Cohort', required: true, index: true },
  course_id: { type: Id, ref: 'Course', default: null },
  title: { type: String, required: true },
  description: String,
  due_at: { type: Date, default: null },
  created_by: { type: Id, ref: 'User', default: null },
}, created))

const submissionSchema = new Schema({
  assignment_id: { type: Id, ref: 'Assignment', required: true },
  student_id: { type: Id, ref: 'Student', required: true },
  note: String,
  file_id: { type: Id, ref: 'File', default: null },
  submitted_at: { type: Date, default: Date.now },
  feedback: String,
  score: { type: Number, default: null },
  reviewed_by: { type: Id, ref: 'User', default: null },
  reviewed_at: { type: Date, default: null },
})
submissionSchema.index({ assignment_id: 1, student_id: 1 }, { unique: true })
export const Submission = model('Submission', submissionSchema)

export const Announcement = model('Announcement', new Schema({
  title: { type: String, required: true },
  body: { type: String, required: true },
  audience: { type: String, enum: ['all', 'programme', 'cohort'], default: 'all' },
  programme_id: { type: Id, ref: 'Programme', default: null },
  cohort_id: { type: Id, ref: 'Cohort', default: null },
  is_pinned: { type: Boolean, default: false },
  expires_at: { type: Date, default: null },
  created_by: { type: Id, ref: 'User', default: null },
}, created))

export const StudentRequest = model('StudentRequest', new Schema({
  student_id: { type: Id, ref: 'Student', required: true, index: true },
  type: { type: String, required: true, enum: ['transcript', 'recommendation', 'change_of_details', 'other'] },
  details: { type: String, required: true },
  status: { type: String, enum: ['open', 'in_progress', 'completed', 'rejected'], default: 'open' },
  response: String,
  handled_by: { type: Id, ref: 'User', default: null },
}, ts))

export const Feedback = model('Feedback', new Schema({
  student_id: { type: Id, ref: 'Student', required: true },
  cohort_id: { type: Id, ref: 'Cohort', default: null },
  course_id: { type: Id, ref: 'Course', default: null },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comments: String,
}, created))

export const Certificate = model('Certificate', new Schema({
  student_id: { type: Id, ref: 'Student', required: true, index: true },
  programme_id: { type: Id, ref: 'Programme', default: null },
  cohort_id: { type: Id, ref: 'Cohort', default: null },
  title: { type: String, required: true },
  grade: String,
  issued_on: { ...day, default: () => new Date().toISOString().slice(0, 10) },
  serial: { type: String, required: true, unique: true },
  verification_code: { type: String, required: true, unique: true },
  revoked_at: { type: Date, default: null },
  revoke_reason: String,
  created_by: { type: Id, ref: 'User', default: null },
}, created))

// ── Leads, messaging, settings, audit ────────────────────────────────────────

const leadSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, default: null },
  phone: { type: String, default: null },
  programme_interest: String,
  preferred_start: String,
  heard_about: String,
  message: String,
  source: { type: String, default: 'enquiry' },
  status: { type: String, enum: ['new', 'contacted', 'interested', 'applied', 'enrolled', 'not_interested'], default: 'new' },
  consent: { type: Boolean, required: true },
  notes: String,
  follow_up_on: day,
}, ts)
leadSchema.index({ status: 1, created_at: -1 })
leadSchema.index({ email: 1 })
export const Lead = model('Lead', leadSchema)

export const MessageLog = model('MessageLog', new Schema({
  channel: { type: String, default: 'email' },
  recipient: { type: String, required: true },
  subject: String,
  status: { type: String, required: true }, // sent | logged | failed
  error: String,
  sent_by: { type: Id, ref: 'User', default: null },
}, created))

export const Setting = model('Setting', new Schema({
  _id: String, // setting key
  value: { type: Schema.Types.Mixed, required: true },
  updated_by: { type: Id, ref: 'User', default: null },
}, { timestamps: { createdAt: false, updatedAt: 'updated_at' }, minimize: false }))

const auditSchema = new Schema({
  user_id: { type: Id, ref: 'User', default: null },
  action: { type: String, required: true },
  entity: String,
  entity_id: String,
  details: Schema.Types.Mixed,
  ip: String,
}, created)
auditSchema.index({ created_at: -1 })
export const AuditLog = model('AuditLog', auditSchema)

/** Creates collections and indexes once per server start (needed before transactions can write to them). */
export async function syncIndexes() {
  const all = [User, Session, AuthToken, RateLimit, Counter, File, Programme, Course, GradingScheme, Cohort, Student, Application,
    Result, ResultCorrection, DocumentVerification, Invoice, Payment, SponsorInvoice, Attendance, TimetableEntry, Material,
    Assignment, Submission, Announcement, StudentRequest, Feedback, Certificate, Lead, MessageLog, Setting, AuditLog]
  await Promise.all(all.map(async (m) => {
    await m.createCollection().catch(() => {})
    await m.createIndexes()
  }))
}
