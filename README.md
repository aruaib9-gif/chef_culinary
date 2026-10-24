# The Chefs Culinary Academy — Website & Student Management Platform

Monorepo (npm workspaces) built from the *Website Requirements & Feature Specification v1.0*.

| Path | What | Stack | Deployed to Render as |
|---|---|---|---|
| `apps/web` | Public website, online application, student/applicant portal (`/portal`), certificate verification (`/verify`) | React + Vite, vanilla CSS | Static site `cca-web` |
| `apps/admin` | Admin / staff back office (separate app & domain) | React + Vite, vanilla CSS | Static site `cca-admin` |
| `server` | REST API, PDFs, emails, Paystack, daily jobs | Node 22 + Express 5, PostgreSQL (`pg`), zod | Web service `cca-api` + cron `cca-daily-jobs` |
| `packages/shared` | Grading rules, formatting, seed data, design tokens (CSS) | Plain ES modules | — (bundled into the others) |

## Getting started (local)

Requires Node 22.9+ and PostgreSQL.

```bash
npm install
cp server/.env.example server/.env          # set DATABASE_URL, JWT_SECRET, SEED_ADMIN_*
cp apps/web/.env.example apps/web/.env
cp apps/admin/.env.example apps/admin/.env
createdb chefs_academy
npm run db:migrate
npm run seed:demo --workspace server        # catalogue + super admin + a demo cohort/student
npm run dev                                 # API :4000, website :5173, admin :5174
```

- Admin: http://localhost:5174 — sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (default seed admin `admin@chefsculinary.com`; you'll be asked to change the password).
- The API allows browser requests from ports 5173, 5174 and 5175 (`CORS_ORIGINS` in `server/.env`).
- Student portal: http://localhost:5173/portal — demo student `student@example.com` (ID `CCA/2026/0001`) / `Student123`.
- Without SMTP configured, every email (reset links, OTP codes, receipts) is printed in the API console.
- `npm test --workspace server` runs the end-to-end API test suite against `DATABASE_URL` (use a dev database).

## What's built

**Auth & security (§8.1, §12)** — applicant sign-up; sign-in with email *or* student ID; bcrypt passwords with strength rules;
lockout after 5 failed attempts (15 min); optional emailed OTP two-step verification (can be forced for all staff);
forgot/reset password by email; revocable bearer sessions (7 days students, 1 day staff); rate limiting; honeypot anti-spam;
role-based access (super admin / staff / student / applicant); audit trail of admin actions; file uploads type-sniffed and capped at 5 MB.

**Admissions (§7)** — multi-step application saved server-side (resume on any device), document uploads, submission checks,
status tracking in the portal, admin review with notes, status emails, admission letter PDF emailed on admit,
one-click enrolment (student record, `CCA/YYYY/NNNN` ID, role switch, tuition charges from the programme's instalment plan).

**Student portal (§8)** — dashboard (programme, cohort, current week, fee balance, latest result, next class, notices, attendance),
results with practical/theory/total/grade/remark and PDF result slip with QR verification, results withheld while owing (setting),
payments (schedule, history, PDF receipts, Paystack checkout), timetable, course outline (programme and per-course documents uploaded by admin), attendance, materials, assignment submissions with feedback,
notices, certificates, ID card PDF, transcript/letter/change-of-details requests, course feedback, profile with photo, password and 2FA.

**Admin (§9)** — dashboard KPIs; leads pipeline with notes, follow-ups, bulk status, CSV export; applications; students
(add, edit, archive, CSV import with dry-run validation, portal account management, ID cards); cohorts incl. sponsored cohorts
and rules; timetable builder with clash detection; programmes (fees, instalment plans, page content) and courses, each with an uploadable course outline;
**editable grading schemes**; score entry grid + CSV upload, auto totals/grades, publish per cohort/course,
corrections that require a reason and are logged; analytics (pass rates, top performers, at-risk); attendance sheets (printable),
reports and low-attendance alerts; materials & assignments with marking; finance (manual payments with proof, receipts, refunds,
charges/discounts/scholarships/sponsor credits, cohort-wide charges, debtors, reminders, income reports by day/week/month/programme/method,
sponsor invoices PDF); certificates (single or whole cohort, revoke, email, public verification); announcements and bulk email;
student requests and feedback; reports and exports; settings (contact details, social links, policies), staff users, audit log, email log.

**Automation** — `cca-daily-jobs` runs at 08:00 Lagos time: fee reminders 3 days before and 1/7/14 days after due dates,
lead follow-ups at 3 and 10 days, and cleanup of expired sessions/tokens and abandoned draft uploads.

## Structure notes

- **Database**: plain SQL migrations in `server/src/db/migrations` (forward-only, applied in order by `npm run migrate`).
  `npm run seed` is idempotent (catalogue, default grading scheme, first super admin). Render runs both before every deploy.
- **Money** is stored in kobo (`BIGINT`). Balance = charges − (discounts + scholarships + sponsor credits) − successful payments.
- **Grading** bands and components live in `grading_schemes` (default seeded from `packages/shared/src/gradingScheme.js`) and are
  edited in Admin → Results & grading → Grading scheme. Courses can use their own scheme.
- **Files** (documents, photos, materials, proofs) are stored in Postgres, because Render's disk is ephemeral; they're included in DB backups.
- **PDFs** (receipts, result slips, admission letters, certificates, ID cards, sponsor invoices) are generated by `server/src/lib/pdf.js`
  with the logo in `server/assets/logo.jpg`. Certificate and result-slip QR codes point to `WEB_URL/verify`.
- **Payments**: Paystack hosted checkout (card, transfer, USSD) — card details never reach our server. Payments settle on the redirect back
  *and* via the signed webhook (`POST /api/payments/paystack/webhook`), idempotently, with amount checks.

## Deploying to Render

`render.yaml` is a Render Blueprint (API, cron job, two static sites — Frankfurt region, closest to Nigeria).
The database already exists: **`cca-db`** (free plan, Frankfurt, id `dpg-dbearalg1s2s73f0cd1g-a`), migrated and seeded with the
catalogue, grading scheme and super admin `admin@chefsculinary.com`. The Blueprint doesn't create or manage it. Free Render databases
are deleted after 30 days (this one on 23 Nov 2026) and have no backups — upgrade it in the dashboard before going live; data is kept.

1. Push the repo to GitHub with `package-lock.json` committed (builds use `npm ci`).
2. In Render: **New → Blueprint**, select the repo, and fill in the prompted values:
   - `cca-api` and `cca-daily-jobs`: `DATABASE_URL` = cca-db's **Internal Database URL** (Dashboard → cca-db → Connect)
   - `cca-api`: `WEB_URL`, `ADMIN_URL`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `PAYSTACK_SECRET_KEY`, SMTP settings, `EMAIL_FROM`, `ADMIN_NOTIFY_EMAILS`
   - `cca-daily-jobs`: the same `WEB_URL` and SMTP settings
   - `cca-web` / `cca-admin`: `VITE_API_URL` = the API's URL (e.g. `https://cca-api.onrender.com`)
3. In the Paystack dashboard set the webhook URL to `https://<api-host>/api/payments/paystack/webhook`.
4. Add custom domains (e.g. `thechefsculinaryacademy.com`, `admin.thechefsculinaryacademy.com`, `api.thechefsculinaryacademy.com`),
   then update `WEB_URL`, `ADMIN_URL` and `VITE_API_URL` to match and redeploy the static sites.
5. Sign in to the admin app with the seed super admin, change the password, then add staff under Settings → Staff users.

Plan names and region in `render.yaml` are starting points — if the Blueprint rejects a plan name, pick the equivalent in the dashboard.
Use a paid Postgres plan for daily backups and point-in-time recovery (spec §12). New migrations still run automatically on each API deploy.

## Still to do / needs the academy's input

- Final programme fees, intake dates and course details (enter them in Admin → Programmes & courses).
- SMTP provider and Paystack account keys; an SMS/WhatsApp gateway (SMS alerts and SMS password reset are not implemented yet).
- CMS for blog, gallery, events and testimonials (these public pages still use bundled content), online shop, alumni/jobs portal,
  Google sign-in, reCAPTCHA, analytics pixels, and the application-fee payment step.
- Confirm grading details (kitchen safety marks, treatment of scores below 50) and adjust the grading scheme.
