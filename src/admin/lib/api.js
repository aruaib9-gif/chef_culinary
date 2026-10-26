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
