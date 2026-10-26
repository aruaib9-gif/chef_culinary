// Programme catalogue (spec §5.2). `fee: null` = [TO BE SUPPLIED] by the academy.
export const programmeTypes = {
  professional: 'Professional',
  cohort: 'Sponsored cohort',
  short: 'Short course',
}

export const programmes = [
  {
    slug: 'professional-cookery',
    name: 'Professional Cookery Programme',
    type: 'professional',
    summary: 'Nigerian, African, Asian and European cuisines — theory and practical.',
    durationWeeks: 16,
    schedule: 'Mon, Wed, Fri',
    fee: null,
    feeCovers: ['Handbook and workbook', 'Uniform', 'Class assignments', 'Project work'],
    courses: [
      'cookery-food-safety',
      'food-production',
      'inventory-management',
      'food-costing',
      'entrepreneurship',
      'restaurant-management',
    ],
  },
  {
    slug: 'sponsored-cohorts',
    name: 'Sponsored Cohort Programmes',
    type: 'cohort',
    summary: 'Dedicated programmes for organisations sending trainees (e.g. SUPA ITF).',
    durationWeeks: 12,
    schedule: 'Mon, Wed, Fri',
    fee: null,
    feeCovers: [],
    courses: ['cookery-food-safety', 'food-production', 'food-costing', 'entrepreneurship'],
  },
  {
    slug: 'short-courses',
    name: 'Short Courses & Workshops',
    type: 'short',
    summary: 'Focused courses in baking, pastry and more. Bookable online.',
    durationWeeks: 8,
    schedule: 'Mon, Wed, Fri',
    fee: null,
    feeCovers: [],
    courses: ['cookery-food-safety', 'food-production'],
  },
]

export function getProgramme(slug) {
  return programmes.find((p) => p.slug === slug)
}
