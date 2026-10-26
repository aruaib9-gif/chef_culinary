import { z } from 'zod'
import { badRequest } from '../http.js'

// Parses data with a zod schema, throwing a 400 with per-field messages on failure.
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {})
  if (result.success) return result.data
  const fields = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_'
    fields[key] ??= issue.message
  }
  throw badRequest('Please check the highlighted fields', fields)
}

// MongoDB ids are 24-character hex strings.
export const id = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Invalid id')
export const idParam = (req, name = 'id') => parse(z.object({ [name]: id }), req.params)[name]

export const optionalText = (max = 2000) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null))
export const requiredText = (max = 200) => z.string().trim().min(1, 'Required').max(max)
export const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254)
export const phone = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
export const optionalDate = dateStr.optional().nullable().or(z.literal('').transform(() => null))
export const kobo = z.coerce.number().int().min(0)
export const optionalId = z.union([id, z.literal(''), z.null()]).optional().transform((v) => v || null)

export const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .refine((v) => /[a-z]/i.test(v) && /\d/.test(v), 'Include at least one letter and one number')

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
})

export function paged(items, total, { page, pageSize }) {
  return { items, total, page, pageSize }
}
