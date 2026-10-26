// npm run seed        → catalogue, grading scheme, first super admin (from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
// npm run seed:demo   → the same, plus a demo cohort and student (local development only)
import { existsSync } from 'node:fs'
import mongoose from 'mongoose'

for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f)
const { seed } = await import('../src/server/db/seed.js')
try {
  await seed({ demo: process.env.SEED_DEMO === '1' })
} finally {
  await mongoose.disconnect()
}
