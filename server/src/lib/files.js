import multer from 'multer'
import { config } from '../config.js'
import { badRequest } from '../middleware/errors.js'

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
})

// Identify file type from its magic bytes rather than trusting the client's Content-Type.
function sniff(buf) {
  if (buf.length < 4) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf'
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'application/zip' // docx/xlsx/pptx
  return null
}

const OFFICE = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const DOC_TYPES = [...IMAGE_TYPES, 'application/pdf']
export const MATERIAL_TYPES = [...DOC_TYPES, ...Object.values(OFFICE)]

/** Validates an uploaded multer file against allowed types and returns { filename, mimeType, data }. */
export function checkUpload(file, allowed = DOC_TYPES) {
  if (!file) throw badRequest('Please attach a file')
  let type = sniff(file.buffer)
  if (type === 'application/zip') {
    const ext = file.originalname.split('.').pop()?.toLowerCase()
    type = OFFICE[ext] ?? null
  }
  if (!type || !allowed.includes(type)) {
    throw badRequest(`Unsupported file type. Allowed: ${allowed.map((t) => t.split('/').pop().replace(/^vnd.*\./, '')).join(', ')}`)
  }
  const filename = file.originalname.replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || 'file'
  return { filename, mimeType: type, data: file.buffer }
}

export async function storeFile(db, file, ownerUserId, allowed) {
  const f = checkUpload(file, allowed)
  const row = await db.one(
    'INSERT INTO files (owner_user_id, filename, mime_type, size_bytes, data) VALUES ($1,$2,$3,$4,$5) RETURNING id, filename, mime_type, size_bytes',
    [ownerUserId, f.filename, f.mimeType, f.data.length, f.data],
  )
  return row
}

export async function sendFile(res, db, fileId, { inline = true } = {}) {
  const f = await db.one('SELECT filename, mime_type, data FROM files WHERE id = $1', [fileId])
  if (!f) return res.status(404).json({ error: 'File not found' })
  res.setHeader('Content-Type', f.mime_type)
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${f.filename.replace(/"/g, '')}"`)
  res.setHeader('Cache-Control', 'private, max-age=300')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.send(f.data)
}
