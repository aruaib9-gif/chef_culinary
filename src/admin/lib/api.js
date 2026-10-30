import { readJSON, writeJSON, remove } from './safeStorage.js'

// API base URL. Empty (the default) = same origin: requests go to /api on this site's own address
// (the Vite dev server and Nginx forward them to the backend). Set VITE_API_URL at build time only when the API
// lives on a different domain, e.g. https://api.thechefsculinaryacademy.com on cPanel or Render.
const BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
const TOKEN_KEY = 'cca.admin.token'

export const getToken = () => readJSON(TOKEN_KEY, null)
export const setToken = (t) => (t ? writeJSON(TOKEN_KEY, t) : remove(TOKEN_KEY))

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details ?? {}
  }
}

async function request(path, { method = 'GET', body, form, headers } = {}) {
  const token = getToken()
  let res
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.')
  }
  if (res.status === 401 && token) {
    setToken(null)
    window.dispatchEvent(new Event('cca-admin:signed-out'))
  }
  return res
}

/** JSON request. `form` (FormData) is sent as multipart for file uploads. */
export async function api(path, options) {
  const res = await request(path, options)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details)
  return data
}

/** Fetches an authenticated file (PDF, upload) and either saves it or opens it in a new tab. */
export async function fetchFile(path, { filename, open = false } = {}) {
  // Open the tab synchronously so pop-up blockers allow it, then point it at the blob.
  const win = open ? window.open('', '_blank') : null
  const res = await request(path)
  if (!res.ok) {
    win?.close()
    const data = await res.json().catch(() => null)
    throw new ApiError(res.status, data?.error ?? 'Could not download the file')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  if (win) {
    win.location.href = url
  } else {
    const name = filename ?? /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download'
    const a = Object.assign(document.createElement('a'), { href: url, download: name })
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Returns an object URL for an authenticated image (e.g. profile photo), or null. */
export async function fetchImageUrl(path) {
  const res = await request(path)
  if (!res.ok) return null
  return URL.createObjectURL(await res.blob())
}

/**
 * Uploads a file straight to storage (no size limit from the host), then confirms it with the API.
 * Returns the file id to send with the form that uses it. `purpose` decides allowed types and size.
 */
export async function uploadFile(file, purpose) {
  const start = await api('/uploads', { method: 'POST', body: { filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size, purpose } })
  let put
  try {
    put = await fetch(start.uploadUrl, { method: 'PUT', headers: start.headers, body: file })
  } catch {
    throw new ApiError(0, 'The upload failed. Check your connection and try again.')
  }
  if (!put.ok) throw new ApiError(put.status, 'The upload failed. Please try again.')
  const done = await api(`/uploads/${start.fileId}/complete`, { method: 'POST' })
  return done.id
}

/**
 * Uploads a large file (training videos) in parts straight to storage: 3 parts at a time, each retried up to
 * 4 times, so a dropped connection costs one part rather than the whole video. Calls onProgress(0..1).
 * Pass an AbortSignal to cancel; the half-finished upload is discarded.
 */
export async function uploadLargeFile(file, purpose, { onProgress, signal } = {}) {
  const start = await api('/uploads/multipart', { method: 'POST', body: { filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size, purpose } })
  const abort = () => api(`/uploads/multipart/${start.fileId}/abort`, { method: 'POST' }).catch(() => {})
  try {
    if (start.mode === 'single') {
      await putWithProgress(start.uploadUrl, file, start.headers, (loaded) => onProgress?.(loaded / file.size), signal)
      onProgress?.(1)
    } else {
      const loaded = new Array(start.parts.length).fill(0)
      const report = () => onProgress?.(loaded.reduce((a, b) => a + b, 0) / file.size)
      const etags = []
      let next = 0
      async function worker() {
        while (next < start.parts.length) {
          const i = next++
          const part = start.parts[i]
          const blob = file.slice(i * start.partSize, Math.min(file.size, (i + 1) * start.partSize))
          for (let attempt = 1; ; attempt++) {
            try {
              const etag = await putWithProgress(part.url, blob, {}, (n) => { loaded[i] = n; report() }, signal)
              if (!etag) throw new ApiError(0, 'Storage did not confirm a part (check the bucket CORS exposes ETag)')
              etags[i] = { partNumber: part.partNumber, etag }
              break
            } catch (err) {
              if (signal?.aborted || attempt >= 4) throw err
              loaded[i] = 0
              report()
              await new Promise((r) => setTimeout(r, 1500 * attempt))
            }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, start.parts.length) }, worker))
      await api(`/uploads/multipart/${start.fileId}/complete`, { method: 'POST', body: { parts: etags } })
      return start.fileId
    }
    await api(`/uploads/multipart/${start.fileId}/complete`, { method: 'POST', body: { parts: [] } })
    return start.fileId
  } catch (err) {
    await abort()
    if (signal?.aborted) throw new ApiError(0, 'Upload cancelled')
    throw err instanceof ApiError ? err : new ApiError(0, 'The upload failed. Check your connection and try again.')
  }
}

// XHR rather than fetch, for upload progress. Resolves with the response's ETag.
function putWithProgress(url, body, headers, onLoaded, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(headers ?? {})) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => onLoaded(e.loaded)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve(xhr.getResponseHeader('ETag') ?? '')
      : reject(new ApiError(xhr.status, `Upload failed (${xhr.status})`)))
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'))
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled'))
    if (signal) {
      if (signal.aborted) return reject(new ApiError(0, 'Upload cancelled'))
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(body)
  })
}
