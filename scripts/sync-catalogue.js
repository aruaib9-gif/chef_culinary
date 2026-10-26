// npm run catalogue:sync → make the database's programmes and courses match src/shared/programmes.js and courses.js.
// Overwrites the catalogue fields of listed programmes (admin edits to them are replaced). Programmes no longer in the
// list are deleted if nothing uses them, otherwise unpublished. Run once after changing the bundled catalogue.
import { existsSync } from 'node:fs'
import mongoose from 'mongoose'

for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f)
const { programmes } = await import('../src/shared/programmes.js')
const { courses } = await import('../src/shared/courses.js')
const { connectDb } = await import('../src/server/db/mongo.js')
const { Programme, Course, Cohort, Student, Application, Material, Announcement, Certificate } = await import('../src/server/db/models.js')

try {
  await connectDb()
  for (const c of courses) {
    await Course.updateOne({ slug: c.id }, { $set: { name: c.name, type: c.type }, $setOnInsert: { slug: c.id } }, { upsert: true })
  }
  const courseIds = new Map((await Course.find({}, 'slug').lean()).map((c) => [c.slug, c._id]))

  for (const [i, p] of programmes.entries()) {
    await Programme.updateOne(
      { slug: p.slug },
      {
        $set: {
          name: p.name, type: p.type, summary: p.summary, duration_weeks: p.durationWeeks, schedule: p.schedule,
          fee_kobo: p.fee == null ? null : p.fee * 100, fee_covers: p.feeCovers, is_published: true, sort_order: i,
          intake_dates: p.intakeDates ?? null, entry_requirements: p.entryRequirements ?? null, certificate_awarded: p.certificateAwarded ?? null,
          course_ids: p.courses.map((slug) => courseIds.get(slug)).filter(Boolean),
        },
        $setOnInsert: { slug: p.slug },
      },
      { upsert: true },
    )
    console.log(`programme ${p.slug}`)
  }

  const keep = programmes.map((p) => p.slug)
  for (const old of await Programme.find({ slug: { $nin: keep } }, 'slug').lean()) {
    const q = { programme_id: old._id }
    const used = (await Promise.all([Cohort, Student, Application, Material, Announcement, Certificate].map((M) => M.exists(q)))).some(Boolean)
    if (used) {
      await Programme.updateOne({ _id: old._id }, { $set: { is_published: false } })
      console.log(`unpublished ${old.slug} (still used by students or records)`)
    } else {
      await Programme.deleteOne({ _id: old._id })
      console.log(`removed ${old.slug}`)
    }
  }
  console.log('catalogue in sync')
} finally {
  await mongoose.disconnect()
}
