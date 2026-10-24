import { Router } from 'express'
import { many, one } from '../db/pool.js'
import { notFoundError } from '../middleware/errors.js'

export const programmes = Router()

// Shape matches @cca/shared/programmes so the website can fall back to static data seamlessly.
export function toPublicProgramme(p) {
  return {
    id: p.id,
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
    courses: (p.courses ?? []).map((c) => c.slug),
    courseDetails: p.courses ?? [],
  }
}

const SELECT = `
  SELECT p.*, COALESCE(
           json_agg(json_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'type', c.type) ORDER BY pc.sort_order, c.name)
             FILTER (WHERE c.id IS NOT NULL), '[]') AS courses
    FROM programmes p
    LEFT JOIN programme_courses pc ON pc.programme_id = p.id
    LEFT JOIN courses c ON c.id = pc.course_id`

programmes.get('/', async (req, res) => {
  const rows = await many(`${SELECT} WHERE p.is_published GROUP BY p.id ORDER BY p.sort_order, p.name`)
  res.set('Cache-Control', 'public, max-age=60')
  res.json(rows.map(toPublicProgramme))
})

programmes.get('/:slug', async (req, res) => {
  const row = await one(`${SELECT} WHERE p.slug = $1 AND p.is_published GROUP BY p.id`, [req.params.slug])
  if (!row) throw notFoundError('Programme not found')
  res.json(toPublicProgramme(row))
})
