// Courses taught (spec §5.3). A course can belong to several programmes.
export const courses = [
  { id: 'cookery-food-safety', name: 'Cookery and Recipe / Food Safety', type: 'Theory' },
  { id: 'food-production', name: 'Food Production', type: 'Theory and practical' },
  { id: 'inventory-management', name: 'Inventory Management', type: 'Theory' },
  { id: 'food-costing', name: 'Food Costing and Portioning', type: 'Theory' },
  { id: 'food-plating', name: 'Food Plating and Styling', type: 'Practical' },
  { id: 'entrepreneurship', name: 'Entrepreneurship', type: 'Theory' },
  { id: 'restaurant-management', name: 'Restaurant Management and Operations', type: 'Theory' },
]

export function getCourse(id) {
  return courses.find((c) => c.id === id)
}
