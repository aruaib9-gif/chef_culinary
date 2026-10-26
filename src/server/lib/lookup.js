// Batch lookups that replace SQL joins: fetch related documents for many ids in one query.
import { oid } from '../db/mongo.js'

/** Map of String(id) → lean document for the given ids. */
export async function byIds(Model, ids, fields) {
  const unique = [...new Set(ids.filter(Boolean).map(String))]
  if (!unique.length) return new Map()
  const docs = await Model.find({ _id: { $in: unique.map(oid) } }, fields).lean()
  return new Map(docs.map((d) => [String(d._id), d]))
}

/** Value of `field` on the related document, or null. */
export const pick = (map, id, field) => (id ? map.get(String(id))?.[field] ?? null : null)

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const contains = (q) => new RegExp(escapeRegex(q), 'i')

/** Start and end (exclusive) of 'YYYY-MM-DD' range as Dates in UTC. */
export function dayRange(from, to) {
  const range = {}
  if (from) range.$gte = new Date(`${from}T00:00:00Z`)
  if (to) range.$lt = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000)
  return Object.keys(range).length ? range : null
}
