// Server configuration from environment variables (.env.local in development, Vercel env vars in production).
const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// Public base URL of the site: SITE_URL, else Vercel's production URL, else local dev.
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null
const siteUrl = (process.env.SITE_URL || vercelUrl || 'http://localhost:3000').replace(/\/$/, '')

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  mongoUri: process.env.MONGODB_URI,
  // HMAC key for session tokens, one-time codes and local upload links.
  secret: process.env.JWT_SECRET,
  // Website + student portal live at the root; the admin back office at /admin.
  webUrl: siteUrl,
  adminUrl: `${siteUrl}/admin`,
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY ?? '',
  cronSecret: process.env.CRON_SECRET ?? '',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.EMAIL_FROM ?? 'The Chefs Culinary Academy <no-reply@thechefsculinaryacademy.com>',
  },
  adminNotifyEmails: list(process.env.ADMIN_NOTIFY_EMAILS),
  storage: {
    // 's3' for any S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2); 'local' writes to .uploads/ (dev only).
    driver: process.env.STORAGE_DRIVER || (process.env.S3_BUCKET ? 's3' : 'local'),
    bucket: process.env.S3_BUCKET ?? '',
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  sessionDays: { student: 7, staff: 1 },
  maxUploadBytes: 10 * 1024 * 1024,
}

export function assertConfig() {
  for (const [key, value] of [['MONGODB_URI', config.mongoUri], ['JWT_SECRET', config.secret]]) {
    if (!value) throw new Error(`Missing required environment variable ${key}`)
  }
}
