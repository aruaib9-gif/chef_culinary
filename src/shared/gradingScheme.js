// Default grading scheme (spec §8.3.1). Must be admin-editable, so treat this
// as seed data — the live scheme will come from the API.
export const defaultGradingScheme = {
  bands: [
    { grade: 'A', min: 90, max: 100, remark: 'Excellent' },
    { grade: 'B', min: 80, max: 89, remark: 'Very good' },
    { grade: 'C', min: 70, max: 79, remark: 'Good' },
    { grade: 'D', min: 60, max: 69, remark: 'Pass' },
    // Academy to confirm treatment of scores below 50 (spec §16).
    { grade: 'F', min: 0, max: 59, remark: 'Fail' },
  ],
  components: [
    {
      id: 'practical',
      label: 'Food presentation / Cooking techniques (practical)',
      max: 70,
      parts: [
        { id: 'knifeSkills', label: 'Knife skills', max: 20 },
        { id: 'recipeExecution', label: 'Recipe execution and presentation', max: 40 },
        // Balance of practical marks — to be confirmed by the academy.
        { id: 'safetySanitation', label: 'Kitchen safety and sanitation', max: 10 },
      ],
    },
    { id: 'theory', label: 'Theory', max: 30, parts: [] },
  ],
}
