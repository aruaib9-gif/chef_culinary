import { Router } from 'express'
import { z } from 'zod'
import { many, one, query } from '../../db/pool.js'
import { parse, idParam, pagination, paged, optionalText, optionalDate, id } from '../../lib/validate.js'
import { sendCsv } from '../../lib/csv.js'
import { audit } from '../../lib/audit.js'
import { notFoundError } from '../../middleware/errors.js'

export const leads = Router()

const STATUSES = ['new', 'contacted', 'interested', 'applied', 'enrolled', 'not_interested']
const filterSchema = pagination.extend({
  status: z.enum(STATUSES).optional().or(z.literal('')),
  source: z.string().max(40).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

function where(f) {
  const clauses = []
  const params = []
  if (f.status) { params.push(f.status); clauses.push(`status = $${params.length}`) }
  if (f.source) { params.push(f.source); clauses.push(`source = $${params.length}`) }
  if (f.from) { params.push(f.from); clauses.push(`created_at >= $${params.length}::date`) }
  if (f.to) { params.push(f.to); clauses.push(`created_at < $${params.length}::date + 1`) }
  if (f.q) { params.push(`%${f.q}%`); clauses.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length} OR programme_interest ILIKE $${params.length})`) }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

leads.get('/', async (req, res) => {
  const f = parse(filterSchema, req.query)
  const w = where(f)
  const rows = await many(
    `SELECT *, COUNT(*) OVER() AS total_count FROM leads ${w.sql}
      ORDER BY created_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
    w.params,
  )
  const statusCounts = await many('SELECT status, COUNT(*)::int AS n FROM leads GROUP BY status')
  res.json({ ...paged(rows, f), statusCounts })
})

leads.get('/export.csv', async (req, res) => {
  const f = parse(filterSchema, req.query)
  const w = where(f)
  const rows = await many(`SELECT * FROM leads ${w.sql} ORDER BY created_at DESC`, w.params)
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
  const row = await one(
    `UPDATE leads SET status = COALESCE($2, status), notes = COALESCE($3, notes), follow_up_on = $4, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [idParam(req), b.status ?? null, b.notes, b.followUpOn ?? null],
  )
  if (!row) throw notFoundError()
  await audit(req, 'lead.update', 'lead', row.id, b)
  res.json(row)
})

leads.post('/bulk-status', async (req, res) => {
  const b = parse(z.object({ ids: z.array(id).min(1).max(1000), status: z.enum(STATUSES) }), req.body)
  const { rowCount } = await query('UPDATE leads SET status = $2, updated_at = now() WHERE id = ANY($1)', [b.ids, b.status])
  await audit(req, 'lead.bulk_status', 'lead', null, b)
  res.json({ updated: rowCount })
})

leads.delete('/:id', async (req, res) => {
  // Data-deletion requests under NDPA 2023 (spec §12).
  const row = await one('DELETE FROM leads WHERE id = $1 RETURNING id, email', [idParam(req)])
  if (!row) throw notFoundError()
  await audit(req, 'lead.delete', 'lead', row.id)
  res.json({ ok: true })
})
