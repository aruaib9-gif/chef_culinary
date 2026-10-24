// Demo data for local development (SEED_DEMO=1). Never run against production.
import { tx } from './pool.js'
import { hashPassword } from '../lib/security.js'
import { computeResult } from '../lib/results.js'
import { defaultGradingScheme } from '@cca/shared/grading-scheme'
import { nextStudentNumber, raiseTuitionCharges } from '../lib/students.js'

export async function seedDemo() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production')
  await tx(async (t) => {
    if (await t.one(`SELECT 1 FROM cohorts WHERE name = 'PC Demo Cohort'`)) return console.log('demo data already present')
    const prog = await t.one(`UPDATE programmes SET fee_kobo = 45000000,
        instalment_plan = '[{"label":"Deposit","percent":60,"dueWeeks":0},{"label":"Balance","percent":40,"dueWeeks":8}]'
      WHERE slug = 'professional-cookery' RETURNING id`)
    const start = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10)
    const cohort = await t.one(
      `INSERT INTO cohorts (programme_id, name, starts_on, ends_on, schedule, status) VALUES ($1, 'PC Demo Cohort', $2, $2::date + 112, 'Mon, Wed, Fri · 9am–3pm', 'active') RETURNING id`,
      [prog.id, start],
    )
    const user = await t.one(
      `INSERT INTO users (email, password_hash, role, full_name, phone) VALUES ('student@example.com', $1, 'student', 'Ada Okafor', '08012345678') RETURNING id`,
      [await hashPassword('Student123')],
    )
    const s = await t.one(
      `INSERT INTO students (user_id, student_number, first_name, last_name, email, phone, programme_id, cohort_id)
       VALUES ($1, $2, 'Ada', 'Okafor', 'student@example.com', '08012345678', $3, $4) RETURNING id`,
      [user.id, await nextStudentNumber(t), prog.id, cohort.id],
    )
    await raiseTuitionCharges(t, { studentId: s.id, programmeId: prog.id, cohortId: cohort.id, userId: null })
    const slots = [[1, '09:00', '12:00', 'Practical kitchen', 'food-production'], [1, '13:00', '15:00', 'Theory', 'cookery-food-safety'], [3, '09:00', '13:00', 'Practical kitchen', 'food-production'], [5, '10:00', '13:00', 'Food costing', 'food-costing']]
    for (const [d, a, b, title, course] of slots) {
      await t.query(
        `INSERT INTO timetable_entries (cohort_id, day_of_week, start_time, end_time, title, course_id, instructor, venue)
         SELECT $1, $2, $3, $4, $5, id, 'Chef Emeka', 'Main kitchen' FROM courses WHERE slug = $6`,
        [cohort.id, d, a, b, title, course],
      )
    }
    const scores = { knifeSkills: 17, recipeExecution: 34, safetySanitation: 8, theory: 24 }
    const r = computeResult(scores, defaultGradingScheme)
    await t.query(
      `INSERT INTO results (student_id, course_id, cohort_id, scores, total, grade, remark, status, published_at)
       SELECT $1, id, $2, $3, $4, $5, $6, 'published', now() FROM courses WHERE slug = 'food-production'`,
      [s.id, cohort.id, scores, r.total, r.grade, r.remark],
    )
    await t.query(`INSERT INTO announcements (title, body, audience) VALUES ('Welcome to the new term', 'Classes start at 9am sharp. Please bring your full uniform and knife kit.', 'all')`)
    console.log('demo data created: student@example.com / Student123')
  })
}
