import { z } from 'zod'
import { Lead } from '../../db/models.js'
import { parse, idParam, pagination, paged, optionalText, optionalDate, id } from '../../lib/validate.js'
import { sendCsv } from '../../lib/csv.js'
import { audit } from '../../lib/audit.js'
import { contains, dayRange } from '../../lib/lookup.js'
import { Router, notFoundError } from '../../http.js'

export const leads = new Router()

const STATUSES = ['new', 'contacted', 'interested', 'applied', 'enrolled', 'not_interested']
const filterSchema = pagination.extend({
  status: z.enum(STATUSES).optional().or(z.literal('')),
  source: z.string().max(40).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

function filter(f) {
  const q = {}
  if (f.status) q.status = f.status
  if (f.source) q.source = f.source
  const range = dayRange(f.from, f.to)
  if (range) q.created_at = range
  if (f.q) {
    const re = contains(f.q)
    q.$or = [{ name: re }, { email: re }, { phone: re }, { programme_interest: re }]
  }
  return q
}

leads.get('/', async (req, res) => {
  const f = parse(filterSchema, req.query)
  const q = filter(f)
  const [items, total, statusCounts] = await Promise.all([
    Lead.find(q).sort({ created_at: -1 }).skip((f.page - 1) * f.pageSize).limit(f.pageSize).lean(),
    Lead.countDocuments(q),
    Lead.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ])
  res.json({ ...paged(items, total, f), statusCounts: statusCounts.map((s) => ({ status: s._id, n: s.n })) })
})

leads.get('/export.csv', async (req, res) => {
  const rows = await Lead.find(filter(parse(filterSchema, req.query))).sort({ created_at: -1 }).lean()
  await audit(req, 'leads.export', 'lead', null, { count: rows.length })
  sendCsv(res, 'leads.csv', rows, [
    { key: 'created_at', label: 'Date' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' }, { key: 'programme_interest', label: 'Programme' }, { key: 'preferred_start', label: 'Preferred start' },
    { key: 'heard_about', label: 'Heard about us' }, { key: 'source', label: 'Source' }, { key: 'status', label: 'Status' },
    { key: 'follow_up_on', label: 'Follow up' }, { key: 'message', label: 'Message' }, { key: 'notes', label: 'Notes' },
  ])
})

leads.patch('/:id', async (req, res) => {
  const b = parse(z.object({ status: z.enum(STATUSES).optional(), notes: optionalText(5000), followUpOn: optionalDate }), req.body)
  const set = { follow_up_on: b.followUpOn ?? null }
  if (b.status) set.status = b.status
  if (b.notes != null) set.notes = b.notes
  const row = await Lead.findByIdAndUpdate(idParam(req), { $set: set }, { returnDocument: 'after' }).lean()
  if (!row) throw notFoundError()
  await audit(req, 'lead.update', 'lead', row._id, b)
  res.json(row)
})

leads.post('/bulk-status', async (req, res) => {
  const b = parse(z.object({ ids: z.array(id).min(1).max(1000), status: z.enum(STATUSES) }), req.body)
  const r = await Lead.updateMany({ _id: { $in: b.ids } }, { $set: { status: b.status } })
  await audit(req, 'lead.bulk_status', 'lead', null, b)
  res.json({ updated: r.modifiedCount })
})

leads.delete('/:id', async (req, res) => {
  // Data-deletion requests under NDPA 2023 (spec §12).
  const row = await Lead.findByIdAndDelete(idParam(req)).lean()
  if (!row) throw notFoundError()
  await audit(req, 'lead.delete', 'lead', row._id)
  res.json({ ok: true })
})
