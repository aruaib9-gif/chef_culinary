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

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' })
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Postgres constraint violations → client errors rather than 500s.
  if (err.code === '23505') return res.status(409).json({ error: 'That record already exists', detail: err.detail })
  if (err.code === '23503') return res.status(409).json({ error: 'This record is linked to other data', detail: err.detail })
  if (err.code === '23514' || err.code === '22P02' || err.code === '22007' || err.code === '22008') {
    return res.status(400).json({ error: 'Invalid value', detail: err.message })
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' })
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large (max 5 MB)' })

  const status = err.status ?? 500
  if (!err.status || status === 500) console.error(err)
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message, details: err.details })
}
