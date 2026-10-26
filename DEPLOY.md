# Deploying to Vercel with MongoDB Atlas and Cloudflare R2

Three free-tier-friendly services:

| Service | What for | Free tier |
|---|---|---|
| **Vercel** | Hosts the Next.js app (website, portal, admin, API, daily job) | Hobby plan |
| **MongoDB Atlas** | Database | M0 (512 MB) — upgrade to M10+ for backups before going live |
| **Cloudflare R2** | Uploaded files (photos, IDs, materials, outlines, proofs) | 10 GB storage, no download fees |

Do the steps in order — later ones need values from earlier ones.

---

## 1. MongoDB Atlas

1. Sign up at **mongodb.com/atlas** → **Create** a cluster:
   - Tier **M0 (Free)** to start; **Provider AWS**, **Region Frankfurt (eu-central-1)** (closest to Nigeria and to the
     Vercel functions, which `vercel.json` places in Frankfurt).
2. **Database Access** → **Add new database user**: username `cca`, a long generated password (letters and numbers),
   role **Read and write to any database**.
3. **Network Access** → **Add IP address** → **Allow access from anywhere** (`0.0.0.0/0`).
   Vercel functions don't have fixed IP addresses, so this is required; the password protects the database.
4. **Connect** → **Drivers** → copy the connection string, replace `<password>`, and add the database name
   `chefs_academy` before the `?`:

   ```
   mongodb+srv://cca:PASSWORD@cluster0.xxxxx.mongodb.net/chefs_academy?retryWrites=true&w=majority
   ```

## 2. Cloudflare R2 (file storage)

1. In the Cloudflare dashboard → **R2 Object Storage** → **Create bucket**: name `cca-uploads`, location
   **Europe** (or automatic). Keep it **private** (no public access).
2. **Manage R2 API Tokens** → **Create API token** → permission **Object Read & Write**, limited to `cca-uploads`.
   Copy the **Access Key ID**, **Secret Access Key** and the **S3 endpoint**
   (`https://<account-id>.r2.cloudflarestorage.com`).
3. Bucket → **Settings** → **CORS policy** → add (replace the domains with yours; include the `*.vercel.app` address
   until your own domain is set up):

   ```json
   [
     {
       "AllowedOrigins": ["https://thechefsculinaryacademy.com", "https://chefs-culinary-academy.vercel.app"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Browsers upload straight to the bucket and download from it with signed links, so this is required.

> AWS S3 or Backblaze B2 work the same way: set `S3_BUCKET`, `S3_REGION`, credentials, and `S3_ENDPOINT`
> (leave empty for AWS S3), plus an equivalent CORS rule.

## 3. Vercel

1. Sign up at **vercel.com** with GitHub → **Add New → Project** → import `aruaib9-gif/chef_culinary`
   (branch `nextjs` until it's merged into `main`). Framework: **Next.js** (detected). Leave build settings as they are.
2. Before deploying, open **Environment Variables** and add:

   | Key | Value |
   |---|---|
   | `MONGODB_URI` | the Atlas connection string from step 1 |
   | `JWT_SECRET` | a long random string (e.g. run `openssl rand -hex 32`) |
   | `CRON_SECRET` | another long random string |
   | `STORAGE_DRIVER` | `s3` |
   | `S3_BUCKET` | `cca-uploads` |
   | `S3_REGION` | `auto` |
   | `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
   | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | from step 2 |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | e.g. Resend: `smtp.resend.com` / `465` / `resend` / `re_…` |
   | `EMAIL_FROM` | `The Chefs Culinary Academy <no-reply@yourdomain.com>` (a verified sending domain) |
   | `ADMIN_NOTIFY_EMAILS` | e.g. `thechefsculinary@gmail.com,chefacademyphc@gmail.com` |
   | `PAYSTACK_SECRET_KEY` | `sk_test_…` while testing, then `sk_live_…` |
   | `SITE_URL` | your final address, e.g. `https://thechefsculinaryacademy.com` (optional until you add a domain) |

3. **Deploy.** Open `https://<project>.vercel.app/api/health` → it should show `{"status":"ok"}`.

## 4. Create the first admin account

The database starts empty. Run the seed once from your computer, pointing at Atlas:

```bash
git clone https://github.com/aruaib9-gif/chef_culinary.git && cd chef_culinary && git checkout nextjs
npm install
MONGODB_URI='mongodb+srv://…' JWT_SECRET='same-value-as-on-vercel' \
SEED_ADMIN_EMAIL='admin@chefsculinary.com' SEED_ADMIN_PASSWORD='a-strong-password' \
npm run seed
```

It creates the programme catalogue, the grading scheme and the super admin (and does nothing if they already exist).
Sign in at `https://<project>.vercel.app/admin` and change the password when asked.

## 5. Paystack, domain, cron

- **Paystack** → Settings → API Keys & Webhooks → Webhook URL:
  `https://<your-domain>/api/payments/paystack/webhook`.
- **Custom domain**: Vercel → Project → **Domains** → add `thechefsculinaryacademy.com` (and `www`), follow the DNS
  instructions, then set `SITE_URL` to it, add it to the R2 CORS rule, and **Redeploy**.
- **Daily job**: `vercel.json` schedules `/api/cron/daily` at 07:00 UTC (08:00 Lagos). Check it under
  Project → **Settings → Cron Jobs**; it uses `CRON_SECRET` automatically.

## Updating

Push to the branch connected to Vercel — it builds and deploys automatically. Pull requests get preview deployments
(add their `*.vercel.app` address to the R2 CORS rule if you want to test uploads there).

## Before going live

- Upgrade Atlas to **M10** or higher for automatic backups and point-in-time restore (spec §12); M0 has none.
- Use `sk_live_` Paystack keys and a verified email domain.
- Remove `*.vercel.app` from the R2 CORS rule once your domain works.

## Troubleshooting

| Problem | Fix |
|---|---|
| `/api/health` returns an error | Vercel → Project → **Logs**. Usually a wrong `MONGODB_URI` (password, database name) or Atlas Network Access not set to allow everywhere. |
| Uploads fail ("The upload failed") | The R2 CORS rule must list the exact site address (https, no trailing slash) and allow `PUT` with `Content-Type`. |
| Downloads/photos don't show | Same CORS rule must allow `GET`. |
| Emails not arriving | Admin → Announcements & messaging → *Recent emails* shows the error. |
| Sign-in loops back to the login page | `JWT_SECRET` changed between deploys — everyone must sign in again; that's expected. |
