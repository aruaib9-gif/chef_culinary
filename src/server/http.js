// Minimal Express-style router on top of Next.js route handlers.
// Route modules register `router.get('/path/:id', ...guards, handler)`; handlers use a familiar req/res API.
import mongoose from 'mongoose'
import { after } from 'next/server.js'
import { RateLimit } from './db/models.js'

// ── Errors ───────────────────────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details)
export const notFoundError = (msg = 'Not found') => new HttpError(404, msg)
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, msg)

function errorResponse(err) {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message, details: err.details } }
  if (err?.code === 11000) return { status: 409, body: { error: 'That record already exists', detail: err.keyValue } }
  if (err instanceof mongoose.Error.CastError) return { status: 400, body: { error: 'Invalid value', detail: `${err.path}: ${err.value}` } }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.fromEntries(Object.entries(err.errors).map(([k, e]) => [k, e.message]))
    return { status: 400, body: { error: 'Please check the highlighted fields', details } }
  }
  console.error(err)
  return { status: 500, body: { error: 'Internal server error' } }
}

// ── JSON serialisation: _id → id, ObjectIds → strings ────────────────────────

export function out(value) {
  if (value == null) return value
  if (Array.isArray(value)) return value.map(out)
  if (value instanceof mongoose.Types.ObjectId) return String(value)
  if (value instanceof Date || Buffer.isBuffer(value)) return value
  if (typeof value.toObject === 'function') value = value.toObject()
  if (typeof value !== 'object') return value
  const res = {}
  for (const [k, v] of Object.entries(value)) {
    if (k === '__v') continue
    res[k === '_id' ? 'id' : k] = out(v)
  }
  return res
}

// ── Router ───────────────────────────────────────────────────────────────────

export class Router {
  constructor() {
    this.routes = []
    this.guards = []
  }

  // use(guard): applies to routes registered after it (like Express).
  // use(prefix, router): mounts a sub-router; its routes already carry their own guards.
  use(...args) {
    if (typeof args[0] === 'string') {
      const [prefix, sub] = args
      for (const r of sub.routes) this.add(r.method, joinPath(prefix, r.path), r.fns)
    } else {
      this.guards.push(...args)
    }
    return this
  }

  add(method, path, fns) {
    const keys = []
    const pattern = new RegExp(
      `^${path.replace(/\/$/, '').replace(/[.]/g, '\\.').replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}/?$`,
    )
    this.routes.push({ method, path, pattern, keys, fns: [...this.guards, ...fns] })
  }

  get(path, ...fns) { this.add('GET', path, fns); return this }
  post(path, ...fns) { this.add('POST', path, fns); return this }
  put(path, ...fns) { this.add('PUT', path, fns); return this }
  patch(path, ...fns) { this.add('PATCH', path, fns); return this }
  delete(path, ...fns) { this.add('DELETE', path, fns); return this }

  match(method, path) {
    let pathMatched = false
    for (const r of this.routes) {
      const m = r.pattern.exec(path)
      if (!m) continue
      pathMatched = true
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue
      return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }
    }
    return pathMatched ? { methodNotAllowed: true } : null
  }
}

const joinPath = (a, b) => `${a.replace(/\/$/, '')}${b === '/' ? '' : b}` || '/'

// Response builder with the subset of Express's res API the route modules use.
class Res {
  constructor() {
    this.statusCode = 200
    this.headers = new Headers()
    this.payload = undefined
    this.redirectTo = null
  }
  status(code) { this.statusCode = code; return this }
  set(name, value) { this.headers.set(name, value); return this }
  setHeader(name, value) { return this.set(name, value) }
  json(data) { this.payload = { json: out(data) }; return this }
  send(body) { this.payload = { raw: body }; return this }
  sendStatus(code) { this.statusCode = code; this.payload = { raw: '' }; return this }
  redirect(url, status = 302) { this.redirectTo = url; this.statusCode = status; return this }

  toResponse() {
    if (this.redirectTo) return new Response(null, { status: this.statusCode, headers: { ...Object.fromEntries(this.headers), Location: this.redirectTo } })
    if (!this.payload) return new Response(null, { status: 204, headers: this.headers })
    if ('json' in this.payload) {
      this.headers.set('Content-Type', 'application/json; charset=utf-8')
      return new Response(JSON.stringify(this.payload.json), { status: this.statusCode, headers: this.headers })
    }
    return new Response(this.payload.raw, { status: this.statusCode, headers: this.headers })
  }
}

/** Builds an Express-like req from a Fetch Request, parsing JSON or multipart bodies. */
async function buildReq(request, path, params) {
  const url = new URL(request.url)
  const headers = request.headers
  const forwarded = headers.get('x-forwarded-for')
  const req = {
    method: request.method,
    path,
    url: url.pathname + url.search,
    params,
    query: Object.fromEntries(url.searchParams),
    headers,
    ip: forwarded ? forwarded.split(',')[0].trim() : headers.get('x-real-ip') ?? '127.0.0.1',
    get: (name) => headers.get(name),
    body: {},
    rawBody: null,
    file: null,
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    const type = headers.get('content-type') ?? ''
    if (type.includes('application/json')) {
      const text = await request.text()
      req.rawBody = Buffer.from(text)
      if (text) {
        try { req.body = JSON.parse(text) } catch { throw badRequest('Malformed JSON body') }
      }
    } else if (type.includes('multipart/form-data')) {
      const form = await request.formData()
      for (const [key, value] of form.entries()) {
        if (typeof value === 'string') req.body[key] = value
        else if (!req.file) {
          req.file = { fieldname: key, originalname: value.name, mimetype: value.type, size: value.size, buffer: Buffer.from(await value.arrayBuffer()) }
        }
      }
    } else if (type) {
      req.rawBody = Buffer.from(await request.arrayBuffer())
    }
  }
  return req
}

/** Entry point for app/api/[...path]/route.js. */
export async function dispatch(router, request, prepare) {
  const path = new URL(request.url).pathname.replace(/^\/api/, '') || '/'
  const res = new Res()
  try {
    const found = router.match(request.method, path)
    if (!found) throw notFoundError()
    if (found.methodNotAllowed) throw new HttpError(405, 'Method not allowed')
    const req = await buildReq(request, path, found.params)
    if (prepare) await prepare(req)
    const { fns } = found.route
    for (const fn of fns) {
      await fn(req, res)
      if (res.payload || res.redirectTo) break
    }
  } catch (err) {
    const { status, body } = errorResponse(err)
    res.status(status).json(body)
  }
  return res.toResponse()
}

// ── Background work ─────────────────────────────────────────────────────────

/**
 * Runs a task after the response is sent (emails, bulk sends). On Vercel, Next's after() keeps the function
 * alive until it finishes; elsewhere it simply runs in the background. Errors are logged, never thrown.
 */
export function defer(task) {
  const p = Promise.resolve().then(task).catch((err) => console.error('background task failed', err))
  try {
    after(() => p)
  } catch {
    // Outside a request (scripts, tests): the promise still runs.
  }
  return p
}

// ── Rate limiting (fixed window, stored in MongoDB so every instance shares it) ──

export function rateLimit({ windowMs, limit, message = 'Too many attempts. Please wait a few minutes and try again.' }) {
  return async (req) => {
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs
    const key = `${req.path}|${req.ip}|${windowStart}`
    const doc = await RateLimit.findOneAndUpdate(
      { _id: key },
      { $inc: { count: 1 }, $setOnInsert: { expires_at: new Date(windowStart + windowMs) } },
      { upsert: true, returnDocument: 'after' },
    ).lean()
    if (doc.count > limit) throw new HttpError(429, message)
  }
}
