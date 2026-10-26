import { Programme, Course } from '../db/models.js'
import { Router, notFoundError } from '../http.js'

export const programmes = new Router()

// Shape matches src/shared/programmes.js so the website can fall back to static data seamlessly.
export function toPublicProgramme(p, coursesById) {
  const courses = (p.course_ids ?? []).map((cid) => coursesById.get(String(cid))).filter(Boolean)
  return {
    id: String(p._id),
    slug: p.slug,
    name: p.name,
    type: p.type,
    summary: p.summary,
    description: p.description,
    durationWeeks: p.duration_weeks,
    schedule: p.schedule,
    fee: p.fee_kobo != null ? p.fee_kobo / 100 : null,
    applicationFee: p.application_fee_kobo ? p.application_fee_kobo / 100 : 0,
    feeCovers: p.fee_covers ?? [],
    instalmentPlan: p.instalment_plan ?? [],
    intakeDates: p.intake_dates,
    applicationDeadline: p.application_deadline,
    entryRequirements: p.entry_requirements,
    curriculum: p.curriculum,
    outcomes: p.outcomes,
    certificateAwarded: p.certificate_awarded,
    careers: p.careers,
    courses: courses.map((c) => c.slug),
    courseDetails: courses.map((c) => ({ id: String(c._id), slug: c.slug, name: c.name, type: c.type })),
  }
}

async function coursesMap(list) {
  const ids = list.flatMap((p) => p.course_ids ?? [])
  const courses = await Course.find({ _id: { $in: ids } }, 'slug name type').lean()
  return new Map(courses.map((c) => [String(c._id), c]))
}

programmes.get('/', async (req, res) => {
  const rows = await Programme.find({ is_published: true }).sort({ sort_order: 1, name: 1 }).lean()
  const map = await coursesMap(rows)
  res.set('Cache-Control', 'public, max-age=60')
  res.json(rows.map((p) => toPublicProgramme(p, map)))
})

programmes.get('/:slug', async (req, res) => {
  const p = await Programme.findOne({ slug: req.params.slug, is_published: true }).lean()
  if (!p) throw notFoundError('Programme not found')
  res.json(toPublicProgramme(p, await coursesMap([p])))
})
