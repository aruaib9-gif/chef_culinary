// Idempotent seed: catalogue, default grading scheme and the first super admin. Safe to run on every deploy.
// Set SEED_DEMO=1 (local only) to also create a demo cohort, student, timetable and results.
import { programmes } from '@cca/shared/programmes'
import { courses } from '@cca/shared/courses'
import { defaultGradingScheme } from '@cca/shared/grading-scheme'
import { pool, tx } from './pool.js'
import { hashPassword } from '../lib/security.js'

await tx(async (t) => {
  for (const c of courses) {
    await t.query(`INSERT INTO courses (slug, name, type) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`, [c.id, c.name, c.type])
  }
  for (const [i, p] of programmes.entries()) {
    const row = await t.one(
      `INSERT INTO programmes (slug, name, type, summary, duration_weeks, schedule, fee_kobo, fee_covers, is_published, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
       ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [p.slug, p.name, p.type, p.summary, p.durationWeeks, p.schedule, p.fee == null ? null : p.fee * 100, JSON.stringify(p.feeCovers), i],
    )
    if (!row) continue // already seeded — admins own it from here
    for (const [j, slug] of p.courses.entries()) {
      await t.query(
        `INSERT INTO programme_courses (programme_id, course_id, sort_order) SELECT $1, id, $3 FROM courses WHERE slug = $2 ON CONFLICT DO NOTHING`,
        [row.id, slug, j],
      )
    }
  }
  const scheme = await t.one('SELECT id FROM grading_schemes WHERE is_default')
  if (!scheme) {
    await t.query(`INSERT INTO grading_schemes (name, definition, is_default) VALUES ('Academy standard', $1, true)`, [defaultGradingScheme])
  }

  const admins = await t.one(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'super_admin'`)
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD
  if (!admins.n) {
    if (email && password) {
      if (password.length < 10) throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters')
      await t.query(
        `INSERT INTO users (email, password_hash, role, full_name, must_change_password) VALUES ($1, $2, 'super_admin', 'Super Admin', true)
         ON CONFLICT DO NOTHING`,
        [email, await hashPassword(password)],
      )
      console.log(`created super admin ${email} (password change required at first sign-in)`)
    } else {
      console.warn('No super admin exists. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD and re-run the seed.')
    }
  }
})

if (process.env.SEED_DEMO === '1') await (await import('./demo.js')).seedDemo()

console.log('seed complete')
await pool.end()
