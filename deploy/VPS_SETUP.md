# Hosting on a VPS (Hostinger or GoDaddy) — step by step

This puts everything on one Ubuntu server: the website + student portal, the admin app, the API, the PostgreSQL
database, HTTPS certificates, the daily reminder job and nightly database backups.

You'll end up with:

| Address | What |
|---|---|
| `https://yourdomain.com` | Public website and student portal |
| `https://admin.yourdomain.com` | Admin back office |
| `https://yourdomain.com/api/health` | API health check (should say `{"status":"ok"}`) |

Time needed: about 30–45 minutes, most of it waiting for DNS and installs.

---

## Step 1 — Buy the VPS

**Hostinger** (recommended: KVM 1 or KVM 2)

1. Go to hostinger.com → VPS Hosting → choose **KVM 1** (4 GB RAM) or **KVM 2** (8 GB RAM).
2. When asked for the server location, pick one in **Europe** (United Kingdom, France or Lithuania) — closest to Nigeria.
3. When asked for the operating system, choose **Plain OS → Ubuntu 24.04** (not a control panel, not an app template).
4. Set a strong **root password** and save it somewhere safe.
5. When the server is ready, open it in hPanel and copy its **IP address** (e.g. `102.xx.xx.xx`).

**GoDaddy** (1 vCPU / 2 GB or 2 vCPU / 4 GB)

1. Choose the plan, pick **Ubuntu 24.04**, and **no** cPanel/Plesk (they aren't needed and cost extra).
2. Set up the root user/password in the GoDaddy VPS dashboard and note the **IP address**.

---

## Step 2 — Point your domain at the server

In the DNS settings of wherever your domain is registered (Hostinger, GoDaddy, Whogohost, etc.), create three **A records**:

| Type | Name / Host | Value (points to) | TTL |
|---|---|---|---|
| A | `@` | your VPS IP | 300 (or lowest) |
| A | `www` | your VPS IP | 300 |
| A | `admin` | your VPS IP | 300 |

Delete any old A records for `@` or `www` that point somewhere else (for example, a parking page).

Wait until the domain resolves to your server. On your computer run:

```bash
nslookup admin.yourdomain.com
```

When the answer shows your VPS IP, continue. This usually takes 5–30 minutes, occasionally a few hours.

---

## Step 3 — Connect to the server

- **Mac / Linux:** open Terminal.
- **Windows:** open PowerShell.
- **Or** use the browser terminal in Hostinger hPanel ("Browser terminal") / GoDaddy dashboard.

```bash
ssh root@YOUR_VPS_IP
```

Type `yes` when asked about the fingerprint, then your root password (nothing shows while typing — that's normal).

---

## Step 4 — Run the setup script

Paste these lines into the server, **replacing the four values** with yours:

```bash
apt-get update && apt-get install -y git
git clone https://github.com/aruaib9-gif/chef_culinary.git /opt/cca
DOMAIN=yourdomain.com \
EMAIL=you@example.com \
SEED_ADMIN_EMAIL=admin@chefsculinary.com \
SEED_ADMIN_PASSWORD='choose-a-strong-password' \
bash /opt/cca/deploy/setup-server.sh
```

- `DOMAIN` — your domain without `https://` or `www`.
- `EMAIL` — where Let's Encrypt sends certificate expiry warnings.
- `SEED_ADMIN_*` — the first super admin login. Keep the password in single quotes (it may contain `#`, `$`, etc.).

The script takes 5–10 minutes. It installs Node.js 22, PostgreSQL, Nginx and HTTPS, creates the database with a random
password, builds both websites, creates the tables and the super admin, turns on the firewall, and schedules the daily
reminder job (08:00 Lagos time) and nightly backups (02:00).

It ends by printing your three addresses. If the HTTPS step fails because DNS isn't ready yet, wait, then run:

```bash
certbot --nginx --redirect -d yourdomain.com -d www.yourdomain.com -d admin.yourdomain.com
```

---

## Step 5 — Check it works

1. Open `https://yourdomain.com/api/health` → `{"status":"ok"}`.
2. Open `https://yourdomain.com` → the website.
3. Open `https://admin.yourdomain.com` → sign in with the `SEED_ADMIN_EMAIL` / password from Step 4.
   You'll be asked to change the password — do it under **Settings & users → My account**.
4. In the admin, the dashboard will warn that email and Paystack are not configured — that's the next step.

---

## Step 6 — Add email and Paystack

On the server:

```bash
nano /opt/cca/server/.env
```

Fill in:

```ini
# Email — any SMTP provider: Hostinger Email, Zoho, Brevo, Resend, SendGrid, Gmail (app password)…
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=587
SMTP_USER=no-reply@yourdomain.com
SMTP_PASS=your-mailbox-password
EMAIL_FROM=The Chefs Culinary Academy <no-reply@yourdomain.com>
ADMIN_NOTIFY_EMAILS=thechefsculinary@gmail.com,chefacademyphc@gmail.com

# Paystack → Settings → API Keys & Webhooks (use sk_test_… first, then sk_live_…)
PAYSTACK_SECRET_KEY=sk_live_xxxxxxxxxxxxxxxx
```

Save with **Ctrl+O**, **Enter**, then **Ctrl+X**, and restart the API:

```bash
systemctl restart cca-api
```

In the **Paystack dashboard → Settings → API Keys & Webhooks**, set:

- **Webhook URL:** `https://yourdomain.com/api/payments/paystack/webhook`
- **Callback URL:** leave blank (the app sets it per payment).

Test: in the student portal, make a payment with Paystack's test card while using an `sk_test_` key.

---

## Step 7 — Updating the app later

When new code is pushed to GitHub, deploy it with:

```bash
ssh root@YOUR_VPS_IP
bash /opt/cca/deploy/deploy.sh
```

This pulls the code, rebuilds both websites, applies any new database migrations and restarts the API.
It stops with an error message if the API doesn't come back healthy.

---

## Step 8 — Backups

Every night a full database backup is saved to `/var/backups/cca` (kept 14 days). Because uploaded documents,
photos and course outlines are stored **in the database**, this one file backs up everything.

```bash
ls -lh /var/backups/cca          # see backups
systemctl start cca-backup       # take a backup right now
```

**Off-server backups (do this — a backup on the same server doesn't survive losing the server):**

- Turn on your provider's backups too: Hostinger includes **weekly backups** (hPanel → VPS → Backups);
  GoDaddy includes **snapshots**.
- And copy the nightly files somewhere else regularly. From your own computer:

  ```bash
  scp root@YOUR_VPS_IP:/var/backups/cca/*.dump ~/cca-backups/
  ```

**Restoring a backup** (replaces the current data — be sure):

```bash
systemctl stop cca-api
sudo -u postgres pg_restore --clean --if-exists -d chefs_academy /var/backups/cca/chefs_academy-YYYYMMDD-HHMM.dump
systemctl start cca-api
```

Test a restore once (for example on a second, temporary VPS) so you know it works — spec §12 asks for a tested restore process.

---

## Useful commands

| Task | Command |
|---|---|
| API status | `systemctl status cca-api` |
| API logs (live) | `journalctl -u cca-api -f` |
| Last 100 log lines | `journalctl -u cca-api -n 100` |
| Restart API | `systemctl restart cca-api` |
| Run daily jobs now | `systemctl start cca-daily && journalctl -u cca-daily -n 20` |
| When jobs/backups run next | `systemctl list-timers 'cca-*'` |
| Edit settings | `nano /opt/cca/server/.env` then `systemctl restart cca-api` |
| Database shell | `sudo -u postgres psql chefs_academy` |
| Nginx check / reload | `nginx -t && systemctl reload nginx` |
| HTTPS renewal test | `certbot renew --dry-run` (renewal itself is automatic) |
| Disk space | `df -h` |

## Troubleshooting

- **Site shows "502 Bad Gateway"** — the API isn't running: `journalctl -u cca-api -n 50` shows why
  (often a typo in `/opt/cca/server/.env`).
- **Emails not arriving** — check Admin → Announcements & messaging → *Recent emails* for `failed` and the error;
  most often the SMTP password or port. Many VPS providers block port 25, so use **587**.
- **Can't sign in after several wrong passwords** — accounts lock for 15 minutes. A super admin can unlock staff
  under Settings & users; students via their profile → Portal account.
- **Forgot the only super admin password** — use "Forgot password?" on the admin login (needs email working), or
  ask a developer to reset it on the server.

## Security notes

- The firewall only allows SSH (22), HTTP (80) and HTTPS (443). The API and database are not reachable from outside.
- Automatic security updates are switched on.
- Recommended: log in with an **SSH key** instead of the root password, then disable password logins
  (`PasswordAuthentication no` in `/etc/ssh/sshd_config`, then `systemctl restart ssh`). Do this only after
  confirming your key works, or you can lock yourself out.
- `/opt/cca/server/.env` holds the database password and secret keys; it's readable only by the app user.

## Moving off Render

The Render database only contains the starter data (catalogue and admin), so nothing needs to be copied.
After the VPS is working, delete the Render database and any Render services so you aren't billed.
