-- Core schema. Grading bands/components are data, not code (spec §8.3.1).

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin', 'staff', 'student')),
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE programmes (
  id             BIGSERIAL PRIMARY KEY,
  slug           TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('professional', 'cohort', 'short')),
  summary        TEXT,
  duration_weeks INT,
  schedule       TEXT,
  fee_kobo       BIGINT,            -- money stored in kobo to avoid float errors
  is_published   BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE courses (
  id   BIGSERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL
);

CREATE TABLE programme_courses (
  programme_id BIGINT REFERENCES programmes(id) ON DELETE CASCADE,
  course_id    BIGINT REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (programme_id, course_id)
);

CREATE TABLE cohorts (
  id           BIGSERIAL PRIMARY KEY,
  programme_id BIGINT NOT NULL REFERENCES programmes(id),
  name         TEXT NOT NULL,
  sponsor      TEXT,                -- e.g. SUPA ITF
  starts_on    DATE,
  ends_on      DATE,
  schedule     TEXT
);

CREATE TABLE students (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT UNIQUE REFERENCES users(id),
  student_number TEXT UNIQUE,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  phone          TEXT,
  cohort_id      BIGINT REFERENCES cohorts(id),
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE grading_schemes (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  definition JSONB NOT NULL,        -- { bands: [...], components: [...] }
  is_default BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE results (
  id           BIGSERIAL PRIMARY KEY,
  student_id   BIGINT NOT NULL REFERENCES students(id),
  course_id    BIGINT NOT NULL REFERENCES courses(id),
  cohort_id    BIGINT NOT NULL REFERENCES cohorts(id),
  scores       JSONB NOT NULL,      -- per-component scores keyed by component id
  total        NUMERIC(5,2) NOT NULL,
  grade        TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  UNIQUE (student_id, course_id, cohort_id)
);

CREATE TABLE leads (
  id                 BIGSERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  email              TEXT,
  phone              TEXT,
  programme_interest TEXT,
  preferred_start    TEXT,
  heard_about        TEXT,
  message            TEXT,
  source             TEXT NOT NULL DEFAULT 'enquiry',
  status             TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'interested', 'applied', 'enrolled', 'not_interested')),
  consent            BOOLEAN NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id          BIGSERIAL PRIMARY KEY,
  student_id  BIGINT REFERENCES students(id),
  amount_kobo BIGINT NOT NULL,
  purpose     TEXT NOT NULL,
  method      TEXT NOT NULL,        -- card, transfer, ussd, cash, bank_deposit
  reference   TEXT UNIQUE,          -- gateway or receipt reference
  status      TEXT NOT NULL DEFAULT 'pending',
  paid_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
