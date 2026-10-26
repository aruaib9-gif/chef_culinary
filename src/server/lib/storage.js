// Uploaded files: metadata in MongoDB (File), bytes in object storage.
//   STORAGE_DRIVER=s3    → any S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2). Private; access via signed URLs.
//   STORAGE_DRIVER=local → .uploads/ on disk (development and tests only).
// Browsers upload directly with a short-lived signed URL, then the API checks the real file type before it's used.
import crypto from 'node:crypto'
import path from 'node:path'
import { mkdir, readFile, writeFile, unlink, open as openFile } from 'node:fs/promises'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from '../config.js'
import { File } from '../db/models.js'
import { badRequest, notFoundError, forbidden } from '../http.js'

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const DOC_TYPES = [...IMAGE_TYPES, 'application/pdf']
const OFFICE = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
export const MATERIAL_TYPES = [...DOC_TYPES, ...Object.values(OFFICE)]

// What can be uploaded for each purpose, by whom, and how large.
export const PURPOSES = {
  application_document: { types: DOC_TYPES, roles: ['applicant', 'student'], maxBytes: 5 * 1024 * 1024 },
  application_photo: { types: IMAGE_TYPES, roles: ['applicant', 'student'], maxBytes: 5 * 1024 * 1024 },
  profile_photo: { types: IMAGE_TYPES, roles: ['student', 'super_admin', 'staff'], maxBytes: 5 * 1024 * 1024 },
  submission: { types: MATERIAL_TYPES, roles: ['student'], maxBytes: 10 * 1024 * 1024 },
  material: { types: MATERIAL_TYPES, roles: ['super_admin', 'staff'], maxBytes: 10 * 1024 * 1024 },
  course_outline: { types: MATERIAL_TYPES, roles: ['super_admin', 'staff'], maxBytes: 10 * 1024 * 1024 },
  payment_proof: { types: DOC_TYPES, roles: ['super_admin'], maxBytes: 5 * 1024 * 1024 },
}

// ── Type sniffing (magic bytes) ──────────────────────────────────────────────

export function sniff(buf, filename = '') {
  if (!buf || buf.length < 4) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf'
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return OFFICE[filename.split('.').pop()?.toLowerCase()] ?? null // docx/xlsx/pptx are zip files
  }
  return null
}

const cleanName = (name) => String(name).replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || 'file'
const typeList = (types) => [...new Set(types.map((t) => t.split('/').pop().replace(/^vnd.*\./, '')))].join(', ')

// ── Drivers ──────────────────────────────────────────────────────────────────

// Local driver only (development/tests); the ignore hints stop Next.js from shipping the whole project with the API.
const LOCAL_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.LOCAL_UPLOAD_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), '.uploads'))
let s3client

function s3() {
  if (!config.storage.bucket) throw new Error('S3_BUCKET is not set')
  s3client ??= new S3Client({
    region: config.storage.region,
    endpoint: config.storage.endpoint,
    forcePathStyle: Boolean(config.storage.endpoint),
    credentials: { accessKeyId: config.storage.accessKeyId, secretAccessKey: config.storage.secretAccessKey },
  })
  return s3client
}

const isLocal = () => config.storage.driver !== 's3'

// Signed token for the local driver's upload/download URLs: key|expiry|mode, HMAC'd.
function localToken(key, mode, ttlSeconds) {
  const payload = Buffer.from(JSON.stringify({ key, mode, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url')
  const sig = crypto.createHmac('sha256', config.secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function readLocalToken(token, mode) {
  const [payload, sig] = String(token).split('.')
  const expected = crypto.createHmac('sha256', config.secret).update(payload ?? '').digest('base64url')
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw forbidden('Invalid link')
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
  if (data.mode !== mode || data.exp < Date.now()) throw forbidden('This link has expired')
  return data.key
}

const localPath = (key) => {
  const p = path.join(/*turbopackIgnore: true*/ LOCAL_DIR, key)
  if (!p.startsWith(LOCAL_DIR)) throw forbidden()
  return p
}

export async function writeLocal(key, buffer) {
  const p = localPath(key)
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, buffer)
}

export const readLocal = (key) => readFile(localPath(key))

async function presignPut(key, contentType) {
  if (isLocal()) return `/api/uploads/local/${localToken(key, 'put', 15 * 60)}`
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, ContentType: contentType }), { expiresIn: 15 * 60 })
}

async function presignGet(key, filename, mimeType, inline) {
  const disposition = `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '')}"`
  if (isLocal()) return `/api/uploads/local/${localToken(key, 'get', 5 * 60)}?d=${encodeURIComponent(disposition)}&t=${encodeURIComponent(mimeType)}`
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: config.storage.bucket, Key: key, ResponseContentDisposition: disposition, ResponseContentType: mimeType }),
    { expiresIn: 5 * 60 },
  )
}

/** First bytes and total size of a stored object, for type checking. */
async function head(key) {
  if (isLocal()) {
    const fh = await openFile(localPath(key)).catch(() => null)
    if (!fh) return null
    try {
      const { size } = await fh.stat()
      const buf = Buffer.alloc(Math.min(16, size))
      await fh.read(buf, 0, buf.length, 0)
      return { size, start: buf }
    } finally {
      await fh.close()
    }
  }
  const meta = await s3().send(new HeadObjectCommand({ Bucket: config.storage.bucket, Key: key })).catch(() => null)
  if (!meta) return null
  const obj = await s3().send(new GetObjectCommand({ Bucket: config.storage.bucket, Key: key, Range: 'bytes=0-15' }))
  return { size: meta.ContentLength, start: Buffer.from(await obj.Body.transformToByteArray()) }
}

async function putObject(key, buffer, contentType) {
  if (isLocal()) return writeLocal(key, buffer)
  await s3().send(new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, Body: buffer, ContentType: contentType }))
}

/** Whole file as a Buffer (used to embed photos in PDFs). */
export async function getFileBuffer(fileId) {
  const f = await File.findById(fileId).lean()
  if (!f) return null
  if (isLocal()) return readLocal(f.key).catch(() => null)
  const obj = await s3().send(new GetObjectCommand({ Bucket: config.storage.bucket, Key: f.key })).catch(() => null)
  return obj ? Buffer.from(await obj.Body.transformToByteArray()) : null
}

async function removeObject(key) {
  if (isLocal()) return unlink(localPath(key)).catch(() => {})
  await s3().send(new DeleteObjectCommand({ Bucket: config.storage.bucket, Key: key })).catch(() => {})
}

// ── Upload flow ──────────────────────────────────────────────────────────────

/** Step 1: create a pending File and a signed URL the browser PUTs the bytes to. */
export async function createUpload(user, { filename, contentType, size, purpose }) {
  const rules = PURPOSES[purpose]
  if (!rules) throw badRequest('Unknown upload type')
  if (!rules.roles.includes(user.role)) throw forbidden()
  if (!rules.types.includes(contentType)) throw badRequest(`Unsupported file type. Allowed: ${typeList(rules.types)}`)
  if (!(size > 0) || size > rules.maxBytes) throw badRequest(`File is too large (max ${rules.maxBytes / 1024 / 1024} MB)`)
  const name = cleanName(filename)
  const key = `${purpose}/${new Date().toISOString().slice(0, 7)}/${crypto.randomBytes(16).toString('hex')}/${name}`
  const file = await File.create({ key, filename: name, mime_type: contentType, size_bytes: size, purpose, owner_user_id: user.id })
  return { fileId: String(file._id), uploadUrl: await presignPut(key, contentType), headers: { 'Content-Type': contentType } }
}

/** Step 2: confirm the upload — checks it exists, its size, and its real type from the file's first bytes. */
export async function completeUpload(user, fileId) {
  const file = await File.findById(fileId)
  if (!file) throw notFoundError('Upload not found')
  if (String(file.owner_user_id) !== String(user.id)) throw forbidden()
  if (file.status === 'ready') return file
  const rules = PURPOSES[file.purpose]
  const info = await head(file.key)
  if (!info) throw badRequest('The file did not finish uploading. Please try again.')
  const type = sniff(info.start, file.filename)
  if (!type || !rules.types.includes(type) || info.size > rules.maxBytes) {
    await removeObject(file.key)
    await file.deleteOne()
    throw badRequest(!type || !rules.types.includes(type) ? `This doesn't look like a valid ${typeList(rules.types)} file` : 'File is too large')
  }
  file.mime_type = type
  file.size_bytes = info.size
  file.status = 'ready'
  await file.save()
  return file
}

/**
 * Resolves the file for a request: either an already-uploaded `fileId` (direct upload) or a small multipart
 * file sent to the API (CSV-sized). Returns the File document, or null when neither was given.
 */
export async function resolveUpload(req, { purpose, field = 'fileId', session } = {}) {
  const rules = PURPOSES[purpose]
  const fileId = req.body?.[field]
  if (fileId) {
    const file = await File.findById(fileId).session(session ?? null)
    if (!file || file.status !== 'ready') throw badRequest('That upload is missing or incomplete')
    if (String(file.owner_user_id) !== String(req.user.id)) throw forbidden()
    if (file.purpose !== purpose) throw badRequest('That upload was made for something else')
    return file
  }
  if (req.file) {
    const type = sniff(req.file.buffer, req.file.originalname)
    if (!type || !rules.types.includes(type)) throw badRequest(`Unsupported file type. Allowed: ${typeList(rules.types)}`)
    if (req.file.size > rules.maxBytes) throw badRequest('File is too large')
    const name = cleanName(req.file.originalname)
    const key = `${purpose}/${new Date().toISOString().slice(0, 7)}/${crypto.randomBytes(16).toString('hex')}/${name}`
    await putObject(key, req.file.buffer, type)
    const [file] = await File.create(
      [{ key, filename: name, mime_type: type, size_bytes: req.file.size, purpose, status: 'ready', owner_user_id: req.user.id }],
      session ? { session } : undefined,
    )
    return file
  }
  return null
}

/** Deletes a File and its stored bytes (best-effort). */
export async function deleteFile(fileId) {
  if (!fileId) return
  const f = await File.findByIdAndDelete(fileId).lean()
  if (f) await removeObject(f.key)
}

/** Sends a file by redirecting to a short-lived signed download URL (permission checks happen before this). */
export async function sendFile(res, fileId, { inline = true } = {}) {
  const f = await File.findById(fileId).lean()
  if (!f || f.status !== 'ready') return res.status(404).json({ error: 'File not found' })
  res.set('Cache-Control', 'private, no-store')
  return res.redirect(await presignGet(f.key, f.filename, f.mime_type, inline))
}
