# Test hosting: websites on Netlify, backend on Render

A free way to test the whole system online:

| Part | Where | Notes |
|---|---|---|
| Website + student portal | Netlify site #1 (package `apps/web`) | Free |
| Admin back office | Netlify site #2 (package `apps/admin`) | Free |
| API (backend) | Render web service | Free plan sleeps after 15 min idle — the first request then takes ~1 minute |
| Database | Render `cca-db` (already created and set up) | Free until **23 Nov 2026**, then deleted unless upgraded |

The backend can't run on Netlify itself (upload size and time limits), which is why it lives on Render.

Order matters, because each side needs the other's address:
**1 → create the two Netlify sites → 2 → create the Render API → 3 → point the Netlify sites at the API.**

---

## Step 1 — Create the two Netlify sites

Do this twice, once per site. Netlify → **Add new project → Import an existing project → GitHub** →
choose `aruaib9-gif/chef_culinary`.

| Setting | Website | Admin |
|---|---|---|
| Base directory | *(leave empty)* | *(leave empty)* |
| Package directory | `apps/web` | `apps/admin` |
| Build command / Publish directory | *(filled in from `netlify.toml`)* | *(filled in from `netlify.toml`)* |

Click **Deploy**. The first build works but can't reach the API yet — that's expected.

Rename them under **Site configuration → Change site name**, e.g. `cca-site` and `cca-admin`, giving:

- `https://cca-site.netlify.app` — website
- `https://cca-admin.netlify.app` — admin

Note both addresses.

---

## Step 2 — Create the API on Render

Render → **New → Web Service** → connect the GitHub repo `aruaib9-gif/chef_culinary`:

| Setting | Value |
|---|---|
| Name | `cca-api` |
| Region | **Frankfurt** (same as the database) |
| Branch | `main` |
| Root directory | *(leave empty)* |
| Runtime | Node |
| Build command | `npm ci --workspace server --include-workspace-root` |
| Start command | `npm run release --workspace server && npm start --workspace server` |
| Instance type | **Free** (for testing) |
| Health check path | `/api/health` (under Advanced) |

The start command runs any new database migrations, then starts the API — this replaces the pre-deploy step
that free instances don't have.

**Environment variables** (Environment tab):

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Render → **cca-db → Connect → Internal Database URL** |
| `JWT_SECRET` | click **Generate** |
| `WEB_URL` | `https://cca-site.netlify.app` *(your website address)* |
| `ADMIN_URL` | `https://cca-admin.netlify.app` *(your admin address)* |
| `SEED_ADMIN_EMAIL` | `admin@chefsculinary.com` |
| `SEED_ADMIN_PASSWORD` | your admin password (only used if no admin exists — `cca-db` already has one) |
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `resend` |
| `SMTP_PASS` | your Resend API key (`re_…`) |
| `EMAIL_FROM` | `The Chefs Culinary Academy <no-reply@yourdomain.com>` (a Resend-verified domain) |
| `ADMIN_NOTIFY_EMAILS` | e.g. `thechefsculinary@gmail.com` |
| `PAYSTACK_SECRET_KEY` | `sk_test_…` for testing (optional) |

`WEB_URL` and `ADMIN_URL` are also the only browser addresses allowed to call the API. To allow more
(e.g. a Netlify preview URL), add `CORS_ORIGINS` with a comma-separated list of every address.

Create the service, wait for **Live**, then open `https://cca-api.onrender.com/api/health` (use the address
Render shows) — it should say `{"status":"ok"}`.

---

## Step 3 — Point both Netlify sites at the API

For **each** Netlify site: **Site configuration → Environment variables → Add a variable**:

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://cca-api.onrender.com` *(your API address, no trailing slash)* |

Then **Deploys → Trigger deploy → Deploy site** (the address is built into the site, so it needs a rebuild).

---

## Step 4 — Test

1. Website: open the Netlify site, go to **Apply** → create an applicant account → fill in the application.
2. Admin: open the admin site → sign in as `admin@chefsculinary.com` → you'll see the application under
   **Applications** → admit and enrol it.
3. Refresh any inner page (e.g. `/portal/results` or `/students/1`) — it should load, not 404.
4. Forgot-password and receipts send real email once the Resend settings are in.
5. Payments (optional): with an `sk_test_` Paystack key, set the Paystack webhook to
   `https://cca-api.onrender.com/api/payments/paystack/webhook` and pay with Paystack's test card.

## What's different from production

- **Slow first load:** the free API sleeps; the first action after a quiet spell waits ~1 minute.
- **No daily job:** fee reminders and lead follow-ups don't run (Render cron jobs aren't free — $1+/month).
  Add one later with command `npm run jobs:daily --workspace server` if you want to test them.
- **Database expiry:** `cca-db` (free) is deleted on 23 Nov 2026 — upgrade it in Render to keep the data.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not reach the server" on the Netlify site | The API is waking up — wait a minute and retry. If it persists, check `VITE_API_URL` is set on that Netlify site and redeploy, and that `WEB_URL`/`ADMIN_URL` on Render match the Netlify addresses exactly (https, no trailing slash). |
| Netlify build fails | Check Package directory is `apps/web` / `apps/admin` and Base directory is empty. |
| Render deploy fails at start | Render → cca-api → Logs. Usually a wrong `DATABASE_URL` (use the **Internal** URL; the service must be in Frankfurt). |
| Emails not sent | Admin → Announcements & messaging → *Recent emails* shows the error; check the Resend key and that `EMAIL_FROM` uses your verified domain. |
