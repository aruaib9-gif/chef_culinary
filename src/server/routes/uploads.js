// Direct-to-storage uploads: the browser asks for a signed URL, PUTs the file there, then confirms.
import { z } from 'zod'
import { parse, idParam, requiredText } from '../lib/validate.js'
import { createUpload, completeUpload, startMultipart, completeMultipart, abortMultipart, readLocalToken, writeLocal, readLocal } from '../lib/storage.js'
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

// Large videos: signed URLs for every part, then join them.
uploads.post('/multipart', requireAuth, rateLimit({ windowMs: 15 * 60_000, limit: 60 }), async (req, res) => {
  res.status(201).json(await startMultipart(req.user, parse(startSchema, req.body)))
})

const partsSchema = z.object({ parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200) })).max(10_000).default([]) })

uploads.post('/multipart/:id/complete', requireAuth, async (req, res) => {
  const f = await completeMultipart(req.user, idParam(req), parse(partsSchema, req.body).parts)
  res.json({ id: f._id, name: f.filename, type: f.mime_type, size: f.size_bytes })
})

uploads.post('/multipart/:id/abort', requireAuth, async (req, res) => {
  await abortMultipart(req.user, idParam(req))
  res.json({ ok: true })
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
  res.set('Accept-Ranges', 'bytes')
  // Byte ranges, so videos can seek (S3/R2 do this themselves).
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') ?? '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1
    if (start >= data.length || start > end) return res.status(416).set('Content-Range', `bytes */${data.length}`).send('')
    res.status(206).set('Content-Range', `bytes ${start}-${end}/${data.length}`)
    return res.send(data.subarray(start, end + 1))
  }
  res.send(data)
})
