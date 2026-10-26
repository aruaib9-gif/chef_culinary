# Hosting on cPanel — step by step

This sets up the academy on cPanel shared hosting:

| Address | What | Where it lives in cPanel |
|---|---|---|
| `https://yourdomain.com` | Public website + student portal | `public_html` |
| `https://admin.yourdomain.com` | Admin back office | the `admin` subdomain's folder |
| `https://api.yourdomain.com` | API (Node.js) | "Setup Node.js App", code in `~/chef_culinary` |

Replace `yourdomain.com` everywhere with your real domain, and `CPUSER` with your cPanel username
(shown in the right-hand column of the cPanel home page).

---

## Step 0 — Check your cPanel has what's needed

Log in to cPanel and use the search box at the top to look for each of these:

| Feature | Needed? | If it's missing |
|---|---|---|
| **Setup Node.js App** (Software section) | **Required** for the API | Ask your host to enable it. If they can't, keep the API on Render or a VPS and only put the two websites on cPanel (Steps 1, 2 and 9). |
| Node.js version **20.12 or newer** (pick it in Setup Node.js App) | Required | Ask the host to add Node 20 or 22. |
| **PostgreSQL Databases** (Databases section) | Recommended | Use an external PostgreSQL database instead — see Step 3, option B. |
| **Terminal** (Advanced section) or SSH access | Required | Ask the host to enable shell/terminal access. |
| **Cron Jobs** (Advanced section) | Required for reminders and backups | Almost always present. |

> The app needs **PostgreSQL**, not MySQL. The "MySQL Databases" feature can't be used.

---

## Step 1 — Create the subdomains

cPanel → **Domains** (or **Subdomains** on older cPanel):

1. Create `admin.yourdomain.com`. Accept the suggested folder (e.g. `/home/CPUSER/admin.yourdomain.com`). Note it.
2. Create `api.yourdomain.com`. Accept the suggested folder too; the Node.js app will take this address over.

If your domain's DNS is managed elsewhere (not by this cPanel host), add **A records** for `admin` and `api`
pointing to the same IP as your main domain.

## Step 2 — Turn on HTTPS

cPanel → **SSL/TLS Status** → tick `yourdomain.com`, `www.yourdomain.com`, `admin.yourdomain.com`,
`api.yourdomain.com` → **Run AutoSSL**. Wait until all show a green padlock (can take a few minutes after DNS changes).

---

## Step 3 — Create the database

### Option A — PostgreSQL on your cPanel (preferred)

cPanel → **PostgreSQL Databases**:

1. **Create New Database**: name it `chefs` → it becomes `CPUSER_chefs`.
2. **Add New User**: name `cca`, and a long password **made of letters and numbers only**
   (symbols like `@ # / :` break the connection URL). It becomes `CPUSER_cca`.
3. **Add User to Database**: choose `CPUSER_cca` and `CPUSER_chefs` → **Submit** (grants all privileges).

Your connection URL is:

```
postgres://CPUSER_cca:THE_PASSWORD@localhost:5432/CPUSER_chefs
```

### Option B — External PostgreSQL (if cPanel has no PostgreSQL)

Use a managed database, then put its **external** connection URL in Step 6 with `DATABASE_SSL=true`:

- **Render** — the existing `cca-db` (upgrade from free before 23 Nov 2026), or a new one ($6/month).
  Render blocks outside connections by default: in Render → cca-db → **Networking → Access Control**, add your
  hosting server's IP address (cPanel home → right column, "Shared IP Address").
- **Neon** (neon.tech) — has a free tier that doesn't expire; copy the connection string it gives you.

Some shared hosts block outgoing connections on port 5432. If Step 7 can't connect, ask your host to open
outgoing port 5432 for your account.

---

## Step 4 — Put the code on the server

cPanel → **Terminal**, then:

```bash
cd ~
git clone https://github.com/aruaib9-gif/chef_culinary.git
```

(Or cPanel → **Git Version Control** → Create → Clone URL `https://github.com/aruaib9-gif/chef_culinary.git`,
Repository Path `/home/CPUSER/chef_culinary`.)

The code must **not** go inside `public_html`.

---

## Step 5 — Create the Node.js application

cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
|---|---|
| Node.js version | the highest available (22.x if offered; at least 20.12) |
| Application mode | **Production** |
| Application root | `chef_culinary/server` |
| Application URL | `api.yourdomain.com` (leave the path box empty) |
| Application startup file | `passenger.cjs` |

Click **Create**. **Do not** press "Run NPM Install" — the next step installs everything correctly.

At the top of the app's page there's a command like:

```
source /home/CPUSER/nodevenv/chef_culinary/server/22/bin/activate && cd /home/CPUSER/chef_culinary/server
```

Copy it — you'll use it in the Terminal whenever you work on the app.

---

## Step 6 — Install and configure

In **Terminal**, paste the command you just copied, then:

```bash
cd ~/chef_culinary
npm ci --workspace server --include-workspace-root --omit=dev --no-audit --no-fund
openssl rand -hex 32        # copy the long random value it prints, for JWT_SECRET below
```

Now create the settings file. cPanel → **File Manager** → Settings (top right) → tick **Show Hidden Files**.
Open `chef_culinary/server`, click **+ File**, name it `.env`, then **Edit** it and paste (with your values):

```ini
NODE_ENV=production
DATABASE_URL=postgres://CPUSER_cca:THE_PASSWORD@localhost:5432/CPUSER_chefs
DATABASE_SSL=false
JWT_SECRET=paste-the-random-value-here

WEB_URL=https://yourdomain.com
ADMIN_URL=https://admin.yourdomain.com
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com,https://admin.yourdomain.com

SEED_ADMIN_EMAIL=admin@chefsculinary.com
SEED_ADMIN_PASSWORD="choose-a-strong-password"

# Email — easiest is a mailbox from cPanel → Email Accounts (e.g. no-reply@yourdomain.com)
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=465
SMTP_USER=no-reply@yourdomain.com
SMTP_PASS=the-mailbox-password
EMAIL_FROM=The Chefs Culinary Academy <no-reply@yourdomain.com>
ADMIN_NOTIFY_EMAILS=thechefsculinary@gmail.com,chefacademyphc@gmail.com

# Paystack → Settings → API Keys & Webhooks (start with sk_test_…)
PAYSTACK_SECRET_KEY=
```

For an external database (Step 3, option B), use its URL and set `DATABASE_SSL=true`.

Save, then right-click `.env` → **Change Permissions** → `600`.

---

## Step 7 — Create the tables and the admin account

In **Terminal** (with the virtual-environment command from Step 5 pasted first):

```bash
cd ~/chef_culinary/server
npm run release
```

You should see `applied 001_init.sql` … `applied 003_course_outlines.sql`, then
`created super admin admin@chefsculinary.com` and `seed complete`.

If you see **"permission denied for schema public"**, your host's PostgreSQL needs one extra grant —
send your host this line and ask them to run it as the database superuser:
`GRANT ALL ON SCHEMA public TO CPUSER_cca;` — then run `npm run release` again.

---

## Step 8 — Start the API

cPanel → **Setup Node.js App** → your app → **Restart**.

Open `https://api.yourdomain.com/api/health` — it should show `{"status":"ok"}`.

---

## Step 9 — Upload the website and admin app

The two websites are built on **your own computer** (building on shared hosting usually runs out of memory).
You need Node.js 22 and Git installed; on Windows use **Git Bash**.

```bash
git clone https://github.com/aruaib9-gif/chef_culinary.git
cd chef_culinary
bash deploy/cpanel/build-frontends.sh https://api.yourdomain.com
```

It creates `deploy/cpanel/out/website.zip` and `deploy/cpanel/out/admin.zip`.

In cPanel → **File Manager**:

1. Open `public_html`. Delete the host's placeholder files (e.g. `index.html`, `default.html`) — keep
   `.well-known` and `cgi-bin` if present. **Upload** `website.zip`, then right-click it → **Extract** → into
   `public_html`. Delete the zip afterwards.
2. Open the admin subdomain's folder from Step 1. **Upload** `admin.zip` → **Extract** → delete the zip.
3. With "Show Hidden Files" on, check each folder contains `index.html`, an `assets` folder and `.htaccess`.

Now check:

- `https://yourdomain.com` → the website. Go to `/portal/login` and refresh the page — it should still load.
- `https://admin.yourdomain.com` → sign in with the `SEED_ADMIN_EMAIL` / password, then change the password
  (Settings & users → My account).

---

## Step 10 — Scheduled jobs: reminders and backups

First, in **Terminal** (after the Step 5 command), run `which node` and copy the path it prints, e.g.
`/home/CPUSER/nodevenv/chef_culinary/server/22/bin/node`.

cPanel → **Cron Jobs** → **Add New Cron Job**:

**Daily reminders and cleanup** — once per day, e.g. Minute `0`, Hour `7`:

```
cd $HOME/chef_culinary/server && /home/CPUSER/nodevenv/chef_culinary/server/22/bin/node src/jobs/daily.js >> $HOME/cca-daily.log 2>&1
```

(cron uses the server's time zone, which may not be Lagos time — adjust the hour if you want it at 08:00 in Lagos.)

**Nightly database backup** (Option A database) — first create a password file so the password isn't in the
cron command. In File Manager (home folder, hidden files shown) create `.pgpass` containing one line:

```
localhost:5432:CPUSER_chefs:CPUSER_cca:THE_PASSWORD
```

set its permissions to `600`, create a folder `cca-backups` in your home folder, then add a cron job,
e.g. Minute `0`, Hour `1`:

```
pg_dump -Fc -h localhost -U CPUSER_cca CPUSER_chefs > $HOME/cca-backups/chefs-$(date +\%Y\%m\%d).dump && find $HOME/cca-backups -name '*.dump' -mtime +14 -delete
```

Uploaded documents, photos and course outlines are stored in the database, so this file backs up everything.
Also download a backup now and then (File Manager → right-click → Download) and keep cPanel's own
**Backup** / JetBackup on, so a copy exists off the server.

---

## Step 11 — Paystack

Paystack dashboard → **Settings → API Keys & Webhooks**:

- Webhook URL: `https://api.yourdomain.com/api/payments/paystack/webhook`

Put the secret key in `.env` (Step 6) and restart the app (Step 8). Test with an `sk_test_` key and Paystack's
test card first, then switch to `sk_live_`.

---

## Updating to a new version

**API** — in Terminal (Step 5 command first):

```bash
cd ~/chef_culinary && git pull
npm ci --workspace server --include-workspace-root --omit=dev --no-audit --no-fund
cd server && npm run release
```

then **Setup Node.js App → Restart** (or run `touch ~/chef_culinary/server/tmp/restart.txt`).

**Websites** — rebuild on your computer (`git pull`, then Step 9's build command) and upload/extract the zips
again, replacing the old files.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| `api.yourdomain.com` shows an error page / 503 | Setup Node.js App → your app → check the log file shown there (or `~/chef_culinary/server/stderr.log`). Usually a typo in `.env` or a database connection problem. |
| `process.loadEnvFile is not a function` | The Node.js version is too old — choose 20.12+ or 22 in Setup Node.js App, then redo Step 6's `npm ci`. |
| Website loads but sign-in says "Could not reach the server" | The site was built with the wrong API address — rebuild with `https://api.yourdomain.com` (Step 9). Also check `CORS_ORIGINS` in `.env` includes the site's exact address, then restart. |
| Refreshing a page gives "404 Not Found" | `.htaccess` is missing from `public_html` or the admin folder — re-extract the zip with hidden files shown. |
| First request after a quiet period is slow | Normal on shared hosting: the app sleeps when idle and takes a few seconds to wake. |
| Emails don't send | Check Admin → Announcements & messaging → *Recent emails* for the error. Try `SMTP_PORT=587` instead of `465`. |
| "Resource limit reached" / app keeps restarting | cPanel → **Resource Usage** shows if you hit CPU/memory limits; ask the host for a bigger plan or move the API to a VPS. |

## Limits of shared hosting

Shared hosting is the cheapest option, but CPU and memory are shared and capped, the app sleeps when idle,
and you depend on what the host allows (Node version, PostgreSQL, outbound ports). It's fine to start with; if the
academy grows or results days get slow, move the API and database to a VPS (see `VPS_SETUP.md`) — the websites can
stay on cPanel.
