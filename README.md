# The Chefs Culinary Academy — Website & Student Management Platform

One **Next.js** app (App Router) with a **MongoDB** database, built from the *Website Requirements & Feature
Specification v1.0*. It is designed to run on **Vercel** with **MongoDB Atlas** and S3-compatible file storage
(Cloudflare R2, AWS S3 or Backblaze B2).

| Part | Where | Path |
|---|---|---|
| Public website (home, programmes, admissions, apply, blog, legal, certificate verification) | `/` | `src/app/(site)`, screens in `src/web` |
| Student / applicant portal | `/portal` | `src/app/(portal)`, screens in `src/web/pages/portal` |
| Admin back office | `/admin` | `src/app/admin`, screens in `src/admin` |
| API (Next.js route handler) | `/api/*` | `src/app/api/[...path]/route.js` → `src/server` |
| Shared grading rules, catalogue, design tokens | — | `src/shared` |

## Run it locally

Requires Node 20.12+ (22 recommended). No MongoDB install needed.

```bash
npm install
cp .env.example .env.local      # set JWT_SECRET and SEED_ADMIN_PASSWORD
npm run db:local                # terminal 1: local MongoDB replica set (data kept in .mongo-data/)
npm run seed:demo               # terminal 2: catalogue, grading scheme, super admin, demo student
npm run dev                     # http://localhost:3000
```

- Website: http://localhost:3000 · Student portal: http://localhost:3000/portal · Admin: http://localhost:3000/admin
- Admin sign-in: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (a password change is required at first sign-in).
- Demo student: `student@example.com` (ID `CCA/2026/0001`) / `Student123`.
- Without SMTP configured, every email (reset links, sign-in codes, receipts) is printed in the terminal.
- With `STORAGE_DRIVER=local`, uploads are saved in `.uploads/`.

Tests: `npm test` runs the end-to-end API suite (sign-up → application → enrolment → results → payments →
certificates → verification, uploads, lockout, audit) against a throwaway in-memory MongoDB.

## How it fits together

- **API** — every `/api/*` request goes to one route handler that dispatches to Express-style route modules in
  `src/server/routes` (`req`/`res`, guards like `requireAdmin`). Validation uses zod; errors return
  `{ error, details }` with field-level messages.
- **Database** — Mongoose models in `src/server/db/models.js`. Field names match the API's JSON. Money is stored in
  kobo; date-only values as `YYYY-MM-DD`. Multi-document changes (enrolment, results, payments, imports) use
  MongoDB transactions, so Atlas (always a replica set) or `npm run db:local` is required.
- **Auth** — opaque bearer tokens, stored hashed in `sessions` with TTL expiry; bcrypt passwords; lockout after 5
  failures; optional emailed sign-in codes; MongoDB-backed rate limits (shared across serverless instances).
- **Files** — browsers upload directly to the bucket with a short-lived signed URL (`POST /api/uploads` → PUT →
  `POST /api/uploads/:id/complete`), then the server checks the real file type from its first bytes. Downloads are
  permission-checked, then redirected to a 5-minute signed URL. ID documents and payment proofs stay private.
- **PDFs** — receipts, result slips, admission letters, certificates, ID cards and sponsor invoices (`pdfkit`), with
  QR codes linking to `/verify`.
- **Payments** — Paystack hosted checkout; payments settle on the redirect back *and* via the signed webhook
  (`/api/payments/paystack/webhook`), exactly once, with amount checks.
- **Daily job** — `GET /api/cron/daily` (Vercel Cron, 08:00 Lagos): fee reminders, lead follow-ups, cleanup.
- **Routing in the screens** — the screens use `Link`, `useNavigate` etc. from `src/lib/router.jsx`, a thin layer
  over Next.js navigation (inside `/admin`, absolute links resolve under `/admin`).

## Deploy

See **[DEPLOY.md](DEPLOY.md)** — Vercel + MongoDB Atlas + Cloudflare R2, step by step.

## Still to do / needs the academy's input

- Final programme fees, intake dates and course details (Admin → Programmes & courses).
- SMTP (e.g. Resend), Paystack keys, an SMS/WhatsApp gateway (SMS alerts are not implemented yet).
- CMS for blog, gallery, events and testimonials (these public pages still use bundled content), online shop,
  alumni/jobs portal, Google sign-in, reCAPTCHA, analytics pixels, and the application-fee payment step.
- Confirm grading details (kitchen safety marks, treatment of scores below 50) and adjust the grading scheme.
