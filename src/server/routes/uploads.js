// Direct-to-storage uploads: the browser asks for a signed URL, PUTs the file there, then confirms.
import { z } from 'zod'
import { parse, idParam, requiredText } from '../lib/validate.js'
import { createUpload, completeUpload, readLocalToken, writeLocal, readLocal } from '../lib/storage.js'
import { requireAuth } from '../middleware/auth.js'
import { config } from '../config.js'
import { Router, rateLimit, notFoundError } from '../http.js'

export const uploads = new Router()

const startSchema = z.object({
  filename: requiredText(200),
  contentType: z.string().trim().min(1).max(150),
  size: z.coerce.number().int().positive(),
  purpose: z.string().trim().max(40),
})

uploads.post('/', requireAuth, rateLimit({ windowMs: 15 * 60_000, limit: 120 }), async (req, res) => {
  res.status(201).json(await createUpload(req.user, parse(startSchema, req.body)))
})

uploads.post('/:id/complete', requireAuth, async (req, res) => {
  const f = await completeUpload(req.user, idParam(req))
  res.json({ id: f._id, name: f.filename, type: f.mime_type, size: f.size_bytes })
})

// Local storage driver only (development/tests): signed upload and download links that stand in for S3.
uploads.put('/local/:token', async (req, res) => {
  if (config.storage.driver === 's3') throw notFoundError()
  const key = readLocalToken(req.params.token, 'put')
  await writeLocal(key, req.rawBody ?? Buffer.alloc(0))
  res.sendStatus(200)
})

uploads.get('/local/:token', async (req, res) => {
  if (config.storage.driver === 's3') throw notFoundError()
  const key = readLocalToken(req.params.token, 'get')
  const data = await readLocal(key).catch(() => null)
  if (!data) throw notFoundError('File not found')
  res.set('Content-Type', req.query.t || 'application/octet-stream')
  res.set('Content-Disposition', req.query.d || 'attachment')
  res.set('Cache-Control', 'private, no-store')
  res.send(data)
})
