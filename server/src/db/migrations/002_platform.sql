-- Platform schema: auth, admissions, student records, academics, finance, CMS settings.
-- Extends 001_init.sql so it applies cleanly on top of an existing database.

-- ───────────────────────────── Users & auth (spec §8.1, §12) ─────────────────────────────

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin', 'staff', 'student', 'applicant'));

ALTER TABLE users
  ADD COLUMN full_name           TEXT NOT NULL DEFAULT '',
  ADD COLUMN phone               TEXT,
  ADD COLUMN is_active           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN two_factor_enabled  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN last_login_at       TIMESTAMPTZ,
  ADD COLUMN password_changed_at TIMESTAMPTZ,
  ADD COLUMN updated_at          TIMESTAMPTZ NOT NULL DEFAULT now();

-- Emails are stored lower-cased; this guards against case-variant duplicates regardless.
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- Opaque bearer sessions (token is hashed; revocable on logout / password change).
CREATE TABLE sessions (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT UNIQUE NOT NULL,
  user_agent   TEXT,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- One-time tokens: password reset links and login OTP codes.
CREATE TABLE auth_tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('password_reset', 'login_otp')),
  token_hash TEXT NOT NULL,
  code_hash  TEXT,               -- login OTP: the 6-digit code, hashed separately from the challenge id
  attempts   INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_lookup_idx ON auth_tokens (purpose, token_hash);

-- Uploaded files live in Postgres: Render's disk is ephemeral and this keeps backups in one place.
CREATE TABLE files (
  id            BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INT NOT NULL,
  data          BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────────── Programmes & courses (spec §5) ─────────────────────────────

ALTER TABLE programmes
  ADD COLUMN description          TEXT,
  ADD COLUMN intake_dates         TEXT,
  ADD COLUMN application_deadline DATE,
  ADD COLUMN fee_covers           JSONB NOT NULL DEFAULT '[]',
  -- [{ "label": "Deposit", "percent": 50, "dueWeeks": 0 }, ...] — percentages of fee_kobo
  ADD COLUMN instalment_plan      JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN entry_requirements   TEXT,
  ADD COLUMN curriculum           TEXT,
  ADD COLUMN outcomes             TEXT,
  ADD COLUMN certificate_awarded  TEXT,
  ADD COLUMN careers              TEXT,
  ADD COLUMN application_fee_kobo BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN sort_order           INT NOT NULL DEFAULT 0,
  ADD COLUMN updated_at           TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE courses
  ADD COLUMN description       TEXT,
  ADD COLUMN is_assessed       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN grading_scheme_id BIGINT REFERENCES grading_schemes(id) ON DELETE SET NULL,
  ADD COLUMN created_at        TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE programme_courses ADD COLUMN sort_order INT NOT NULL DEFAULT 0;

ALTER TABLE grading_schemes ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX grading_schemes_one_default_idx ON grading_schemes (is_default) WHERE is_default;

-- ───────────────────────────── Cohorts & students (spec §9.3) ─────────────────────────────

ALTER TABLE cohorts
  ADD COLUMN status        TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('planned', 'active', 'completed', 'archived')),
  ADD COLUMN capacity      INT,
  ADD COLUMN fee_kobo      BIGINT,      -- overrides programme fee when set (e.g. sponsor rate)
  ADD COLUMN sponsor_email TEXT,
  ADD COLUMN rules         TEXT,        -- sponsored cohort rules & policies
  ADD COLUMN notes         TEXT,
  ADD COLUMN created_at    TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE SEQUENCE student_number_seq START 1;

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_user_id_fkey;
ALTER TABLE students ADD CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE students
  ADD COLUMN email                 TEXT,
  ADD COLUMN gender                TEXT,
  ADD COLUMN date_of_birth         DATE,
  ADD COLUMN address               TEXT,
  ADD COLUMN city                  TEXT,
  ADD COLUMN state                 TEXT,
  ADD COLUMN guardian_name         TEXT,
  ADD COLUMN guardian_phone        TEXT,
  ADD COLUMN guardian_relationship TEXT,
  ADD COLUMN sponsor               TEXT,
  ADD COLUMN photo_file_id         BIGINT REFERENCES files(id) ON DELETE SET NULL,
  ADD COLUMN programme_id          BIGINT REFERENCES programmes(id),
  ADD COLUMN enrolled_on           DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN graduated_on          DATE,
  ADD COLUMN notes                 TEXT,
  ADD COLUMN updated_at            TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE students ADD CONSTRAINT students_status_check
  CHECK (status IN ('active', 'suspended', 'graduated', 'withdrawn', 'archived'));
CREATE INDEX students_cohort_idx ON students (cohort_id);

-- ───────────────────────────── Admissions (spec §7) ─────────────────────────────

CREATE TABLE applications (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference    TEXT UNIQUE NOT NULL,
  programme_id BIGINT REFERENCES programmes(id),
  cohort_id    BIGINT REFERENCES cohorts(id),
  status       TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'received', 'under_review', 'admitted', 'declined', 'waitlisted', 'enrolled')),
  current_step INT NOT NULL DEFAULT 0,
  data         JSONB NOT NULL DEFAULT '{}',   -- personal, guardian, background answers
  student_id   BIGINT REFERENCES students(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  decided_at   TIMESTAMPTZ,
  decided_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX applications_user_idx ON applications (user_id);
CREATE INDEX applications_status_idx ON applications (status);

CREATE TABLE application_documents (
  id             BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  file_id        BIGINT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, kind)
);

CREATE TABLE application_notes (
  id             BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE students ADD COLUMN application_id BIGINT REFERENCES applications(id) ON DELETE SET NULL;

-- ───────────────────────────── Results (spec §8.3, §9.2) ─────────────────────────────

ALTER TABLE results
  ADD COLUMN remark            TEXT,
  ADD COLUMN status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  ADD COLUMN grading_scheme_id BIGINT REFERENCES grading_schemes(id) ON DELETE SET NULL,
  ADD COLUMN entered_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE results DROP CONSTRAINT IF EXISTS results_student_id_fkey;
ALTER TABLE results ADD CONSTRAINT results_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
CREATE INDEX results_cohort_course_idx ON results (cohort_id, course_id);

-- Edits to published results need a reason and are kept forever.
CREATE TABLE result_corrections (
  id         BIGSERIAL PRIMARY KEY,
  result_id  BIGINT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reason     TEXT NOT NULL,
  before     JSONB NOT NULL,
  after      JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────────── Finance (spec §8.4, §9.4, §10) ─────────────────────────────

-- Charges and credits on a student's account. Balance = charges − credits − successful payments.
CREATE TABLE invoices (
  id          BIGSERIAL PRIMARY KEY,
  student_id  BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  cohort_id   BIGINT REFERENCES cohorts(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'tuition'
    CHECK (category IN ('tuition', 'application', 'registration', 'materials', 'uniform', 'project',
                        'short_course', 'event', 'certificate', 'other')),
  kind        TEXT NOT NULL DEFAULT 'charge' CHECK (kind IN ('charge', 'discount', 'scholarship', 'sponsor')),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  due_date    DATE,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at   TIMESTAMPTZ,
  void_reason TEXT
);
CREATE INDEX invoices_student_idx ON invoices (student_id);

CREATE SEQUENCE receipt_number_seq START 1;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_student_id_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
ALTER TABLE payments
  ADD COLUMN invoice_id       BIGINT REFERENCES invoices(id) ON DELETE SET NULL,
  ADD COLUMN receipt_number   TEXT UNIQUE,
  ADD COLUMN gateway          TEXT,              -- paystack | manual
  ADD COLUMN gateway_response JSONB,
  ADD COLUMN proof_file_id    BIGINT REFERENCES files(id) ON DELETE SET NULL,
  ADD COLUMN recorded_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN notes            TEXT,
  ADD COLUMN refunded_at      TIMESTAMPTZ,
  ADD COLUMN refund_reason    TEXT;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'success', 'failed', 'refunded', 'cancelled'));
ALTER TABLE payments ADD CONSTRAINT payments_amount_check CHECK (amount_kobo > 0);
CREATE INDEX payments_student_idx ON payments (student_id);
CREATE INDEX payments_paid_at_idx ON payments (paid_at);

-- Invoices to organisations that pay for a whole cohort (spec §10 "Sponsor billing").
CREATE SEQUENCE sponsor_invoice_seq START 1;
CREATE TABLE sponsor_invoices (
  id             BIGSERIAL PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  cohort_id      BIGINT REFERENCES cohorts(id) ON DELETE SET NULL,
  sponsor_name   TEXT NOT NULL,
  sponsor_email  TEXT,
  description    TEXT NOT NULL,
  amount_kobo    BIGINT NOT NULL CHECK (amount_kobo > 0),
  status         TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'cancelled')),
  issued_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date       DATE,
  paid_on        DATE,
  created_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────────── Academic services (spec §8.5, §9.3) ─────────────────────────────

CREATE TABLE attendance (
  id         BIGSERIAL PRIMARY KEY,
  cohort_id  BIGINT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  marked_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cohort_id, student_id, date)
);

CREATE TABLE timetable_entries (
  id          BIGSERIAL PRIMARY KEY,
  cohort_id   BIGINT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1 = Monday
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  title       TEXT NOT NULL,
  course_id   BIGINT REFERENCES courses(id) ON DELETE SET NULL,
  instructor  TEXT,
  venue       TEXT,
  CHECK (end_time > start_time)
);

CREATE TABLE materials (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  programme_id BIGINT REFERENCES programmes(id) ON DELETE CASCADE,
  cohort_id    BIGINT REFERENCES cohorts(id) ON DELETE CASCADE,
  course_id    BIGINT REFERENCES courses(id) ON DELETE SET NULL,
  file_id      BIGINT REFERENCES files(id) ON DELETE SET NULL,
  url          TEXT,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assignments (
  id          BIGSERIAL PRIMARY KEY,
  cohort_id   BIGINT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  course_id   BIGINT REFERENCES courses(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  due_at      TIMESTAMPTZ,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE submissions (
  id            BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id    BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  note          TEXT,
  file_id       BIGINT REFERENCES files(id) ON DELETE SET NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  feedback      TEXT,
  score         NUMERIC(5,2),
  reviewed_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE announcements (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  audience     TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'programme', 'cohort')),
  programme_id BIGINT REFERENCES programmes(id) ON DELETE CASCADE,
  cohort_id    BIGINT REFERENCES cohorts(id) ON DELETE CASCADE,
  is_pinned    BOOLEAN NOT NULL DEFAULT false,
  expires_at   TIMESTAMPTZ,
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE student_requests (
  id         BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('transcript', 'recommendation', 'change_of_details', 'other')),
  details    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'rejected')),
  response   TEXT,
  handled_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
  id         BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  cohort_id  BIGINT REFERENCES cohorts(id) ON DELETE SET NULL,
  course_id  BIGINT REFERENCES courses(id) ON DELETE SET NULL,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comments   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE certificates (
  id                BIGSERIAL PRIMARY KEY,
  student_id        BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  programme_id      BIGINT REFERENCES programmes(id) ON DELETE SET NULL,
  cohort_id         BIGINT REFERENCES cohorts(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  grade             TEXT,
  issued_on         DATE NOT NULL DEFAULT CURRENT_DATE,
  serial            TEXT UNIQUE NOT NULL,
  verification_code TEXT UNIQUE NOT NULL,
  revoked_at        TIMESTAMPTZ,
  revoke_reason     TEXT,
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE SEQUENCE certificate_serial_seq START 1;

-- ───────────────────────────── Leads, messaging, settings (spec §6, §9.5) ─────────────────────────────

ALTER TABLE leads
  ADD COLUMN notes        TEXT,
  ADD COLUMN follow_up_on DATE,
  ADD COLUMN updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX leads_status_idx ON leads (status, created_at DESC);

CREATE TABLE message_log (
  id         BIGSERIAL PRIMARY KEY,
  channel    TEXT NOT NULL DEFAULT 'email',
  recipient  TEXT NOT NULL,
  subject    TEXT,
  status     TEXT NOT NULL,   -- sent | logged | failed
  error      TEXT,
  sent_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_log ADD COLUMN ip TEXT;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

-- Verification codes printed on result slips (certificates carry their own code).
CREATE TABLE document_verifications (
  code       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  cohort_id  BIGINT REFERENCES cohorts(id) ON DELETE SET NULL,
  snapshot   JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
