const required = ['DATABASE_URL', 'JWT_SECRET']
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var ${key}`)
}

const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

const webUrl = (process.env.WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const adminUrl = (process.env.ADMIN_URL ?? 'http://localhost:5174').replace(/\/$/, '')

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL,
  // Used as the HMAC key for one-time tokens and verification codes.
  jwtSecret: process.env.JWT_SECRET,
  // Public URLs used in emails, Paystack callbacks and QR codes.
  webUrl,
  adminUrl,
  // Browser origins allowed to call the API; defaults to the two frontends.
  corsOrigins: list(process.env.CORS_ORIGINS).length ? list(process.env.CORS_ORIGINS) : [webUrl, adminUrl],
  // Use SSL for Render's external hostnames; internal hostnames (dpg-…) connect without it.
  databaseSsl: process.env.DATABASE_SSL ? process.env.DATABASE_SSL === 'true' : /\.render\.com/.test(process.env.DATABASE_URL),
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY ?? '',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.EMAIL_FROM ?? 'The Chefs Culinary Academy <no-reply@thechefsculinaryacademy.com>',
  },
  adminNotifyEmails: list(process.env.ADMIN_NOTIFY_EMAILS),
  sessionDays: { student: 7, staff: 1 },
  maxUploadBytes: 5 * 1024 * 1024,
}
