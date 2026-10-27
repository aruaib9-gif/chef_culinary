// Website gallery management: upload photos, caption, categorise, reorder, hide or delete them.
import { z } from 'zod'
import { GalleryPhoto } from '../../db/models.js'
import { parse, idParam, id, optionalText } from '../../lib/validate.js'
import { resolveUpload, deleteFile } from '../../lib/storage.js'
import { listGallery, firstSortOrder } from '../../lib/gallery.js'
import { audit } from '../../lib/audit.js'
import { Router, notFoundError } from '../../http.js'

export const gallery = new Router()

const category = z.enum(['classes', 'dishes', 'graduation', 'events'])

gallery.get('/', async (req, res) => {
  res.json(await listGallery({ includeHidden: true }))
})

const createSchema = z.object({
  fileId: id,
  caption: optionalText(200),
  category: category.default('classes'),
  isPublished: z.boolean().default(true),
})

gallery.post('/', async (req, res) => {
  const b = parse(createSchema, req.body)
  const file = await resolveUpload(req, { purpose: 'gallery_photo' })
  const row = await GalleryPhoto.create({
    file_id: file._id, caption: b.caption ?? '', category: b.category, is_published: b.isPublished,
    sort_order: await firstSortOrder(), created_by: req.user.id,
  })
  await audit(req, 'gallery.upload', 'gallery', row._id, { caption: row.caption })
  res.status(201).json(row)
})

const updateSchema = z.object({
  caption: optionalText(200),
  category: category.optional(),
  isPublished: z.boolean().optional(),
})

gallery.patch('/:id', async (req, res) => {
  const b = parse(updateSchema, req.body)
  const set = {}
  if ('caption' in (req.body ?? {})) set.caption = b.caption ?? '' // optionalText turns a missing caption into null
  if (b.category) set.category = b.category
  if (b.isPublished != null) set.is_published = b.isPublished
  const row = await GalleryPhoto.findByIdAndUpdate(idParam(req), { $set: set }, { returnDocument: 'after' }).lean()
  if (!row) throw notFoundError()
  res.json(row)
})

// Swap places with the neighbouring photo.
gallery.post('/:id/move', async (req, res) => {
  const { direction } = parse(z.object({ direction: z.enum(['up', 'down']) }), req.body)
  const rows = await GalleryPhoto.find({}, 'sort_order').sort({ sort_order: 1, created_at: -1 }).lean()
  const i = rows.findIndex((r) => String(r._id) === idParam(req))
  if (i < 0) throw notFoundError()
  const j = direction === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= rows.length) return res.json({ ok: true })
  // Renumber everything so equal sort orders can't stick.
  ;[rows[i], rows[j]] = [rows[j], rows[i]]
  await GalleryPhoto.bulkWrite(rows.map((r, n) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { sort_order: n + 1 } } } })))
  res.json({ ok: true })
})

gallery.delete('/:id', async (req, res) => {
  const row = await GalleryPhoto.findByIdAndDelete(idParam(req)).lean()
  if (!row) throw notFoundError()
  if (row.file_id) await deleteFile(row.file_id)
  await audit(req, 'gallery.delete', 'gallery', row._id, { caption: row.caption })
  res.json({ ok: true })
})
