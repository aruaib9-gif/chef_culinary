import { defaultGradingScheme } from './gradingScheme.js'

// scores: { knifeSkills, recipeExecution, safetySanitation, theory }
export function totalScore(scores, scheme = defaultGradingScheme) {
  return scheme.components.reduce((sum, component) => {
    if (component.parts.length === 0) return sum + (Number(scores[component.id]) || 0)
    return sum + component.parts.reduce((s, part) => s + (Number(scores[part.id]) || 0), 0)
  }, 0)
}

// Matches on each band's lower bound so fractional totals (e.g. 89.5) can't fall between bands.
export function gradeFor(total, scheme = defaultGradingScheme) {
  const band = [...scheme.bands].sort((a, b) => b.min - a.min).find((b) => total >= b.min)
  return band ?? { grade: '—', remark: 'Ungraded' }
}

// Returns the ids of any score fields above their configured maximum.
export function validateScores(scores, scheme = defaultGradingScheme) {
  const fields = scheme.components.flatMap((c) => (c.parts.length ? c.parts : [c]))
  return fields.filter((f) => Number(scores[f.id]) > f.max).map((f) => f.id)
}
