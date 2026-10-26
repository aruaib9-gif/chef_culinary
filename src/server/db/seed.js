// Idempotent seed: catalogue, default grading scheme and the first super admin. Safe to run any time.
// With demo = true (local only) it also creates a demo cohort, student, timetable and results.
import { programmes } from '../../shared/programmes.js'
import { courses } from '../../shared/courses.js'
import { defaultGradingScheme } from '../../shared/gradingScheme.js'
import { Course, Programme, GradingScheme, User, Cohort, Student, TimetableEntry, Result, Announcement } from './models.js'
import { connectDb, withTransaction } from './mongo.js'
import { hashPassword } from '../lib/security.js'
import { computeResult } from '../lib/results.js'
import { nextStudentNumber, raiseTuitionCharges } from '../lib/students.js'

export async function seed({ demo = false, log = console.log } = {}) {
  await connectDb()
  for (const c of courses) {
    await Course.updateOne({ slug: c.id }, { $setOnInsert: { slug: c.id, name: c.name, type: c.type } }, { upsert: true })
  }
  const courseIds = new Map((await Course.find({}, 'slug').lean()).map((c) => [c.slug, c._id]))
  for (const [i, p] of programmes.entries()) {
    // Only inserted once — admins own the catalogue from then on.
    await Programme.updateOne(
      { slug: p.slug },
      {
        $setOnInsert: {
          slug: p.slug, name: p.name, type: p.type, summary: p.summary, duration_weeks: p.durationWeeks, schedule: p.schedule,
          fee_kobo: p.fee == null ? null : p.fee * 100, fee_covers: p.feeCovers, is_published: true, sort_order: i,
          course_ids: p.courses.map((slug) => courseIds.get(slug)).filter(Boolean),
        },
      },
      { upsert: true },
    )
  }
  if (!(await GradingScheme.exists({ is_default: true }))) {
    await GradingScheme.create({ name: 'Academy standard', definition: defaultGradingScheme, is_default: true })
  }

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD
  if (!(await User.exists({ role: 'super_admin' }))) {
    if (email && password) {
      if (password.length < 10) throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters')
      await User.create({ email, password_hash: await hashPassword(password), role: 'super_admin', full_name: 'Super Admin', must_change_password: true })
      log(`created super admin ${email} (password change required at first sign-in)`)
    } else {
      log('No super admin exists. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD and re-run the seed.')
    }
  }
  if (demo) await seedDemo(log)
  log('seed complete')
}

// Demo data for local development. Never run against production.
async function seedDemo(log) {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production')
  if (await Cohort.exists({ name: 'PC Demo Cohort' })) return log('demo data already present')
  await withTransaction(async (session) => {
    const prog = await Programme.findOneAndUpdate(
      { slug: 'professional-cookery' },
      { $set: { fee_kobo: 45000000, instalment_plan: [{ label: 'Deposit', percent: 60, dueWeeks: 0 }, { label: 'Balance', percent: 40, dueWeeks: 8 }] } },
      { returnDocument: 'after', session },
    ).lean()
    const start = new Date(Date.now() - 21 * 86_400_000)
    const end = new Date(start.getTime() + 112 * 86_400_000)
    const [cohort] = await Cohort.create([{
      programme_id: prog._id, name: 'PC Demo Cohort', starts_on: start.toISOString().slice(0, 10), ends_on: end.toISOString().slice(0, 10),
      schedule: 'Mon, Wed, Fri · 9am–3pm', status: 'active',
    }], { session })
    const [user] = await User.create([{ email: 'student@example.com', password_hash: await hashPassword('Student123'), role: 'student', full_name: 'Ada Okafor', phone: '08012345678' }], { session })
    const [student] = await Student.create([{
      user_id: user._id, student_number: await nextStudentNumber(session), first_name: 'Ada', last_name: 'Okafor', email: 'student@example.com',
      phone: '08012345678', programme_id: prog._id, cohort_id: cohort._id,
    }], { session })
    await raiseTuitionCharges(session, { studentId: student._id, programmeId: prog._id, cohortId: cohort._id })
    const course = async (slug) => (await Course.findOne({ slug }, '_id').session(session).lean())._id
    const slots = [[1, '09:00', '12:00', 'Practical kitchen', 'food-production'], [1, '13:00', '15:00', 'Theory', 'cookery-food-safety'], [3, '09:00', '13:00', 'Practical kitchen', 'food-production'], [5, '10:00', '13:00', 'Food costing', 'food-costing']]
    for (const [d, a, b, title, slug] of slots) {
      await TimetableEntry.create([{ cohort_id: cohort._id, day_of_week: d, start_time: a, end_time: b, title, course_id: await course(slug), instructor: 'Chef Emeka', venue: 'Main kitchen' }], { session })
    }
    const scores = { knifeSkills: 17, recipeExecution: 34, safetySanitation: 8, theory: 24 }
    const r = computeResult(scores, defaultGradingScheme)
    await Result.create([{ student_id: student._id, course_id: await course('food-production'), cohort_id: cohort._id, scores, total: r.total, grade: r.grade, remark: r.remark, status: 'published', published_at: new Date() }], { session })
    await Announcement.create([{ title: 'Welcome to the new term', body: 'Classes start at 9am sharp. Please bring your full uniform and knife kit.', audience: 'all' }], { session })
  })
  log('demo data created: student@example.com / Student123')
}
