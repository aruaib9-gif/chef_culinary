'use client'
import { useRef, useState } from 'react'
import { galleryCategories } from '@cca/shared/gallery'
import { useApi } from '../lib/useApi.js'
import { api, uploadFile } from '../lib/api.js'
import { PageHeader, Loading, ErrorBox, Badge, Field, Notice, useAction } from '../components/ui.jsx'

const TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024
const PARALLEL = 3 // uploads at a time

// Phone/camera formats browsers can't display. We convert them to JPEG in the browser
// before upload. These files often have an empty file.type, so we also match the extension.
const isHeic = (file) => /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)
const isDng = (file) => /dng/i.test(file.type) || /\.dng$/i.test(file.name)
const isConvertible = (file) => isHeic(file) || isDng(file)

async function heicToJpeg(file) {
  const heic2any = (await import('heic2any')).default
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
  const out = Array.isArray(blob) ? blob[0] : blob
  return new File([out], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' })
}

// DNG is RAW (TIFF-based). Phones and Lightroom embed a full-size JPEG preview; we pull out
// the largest embedded JPEG and use that — web-quality and displayable everywhere.
async function dngToJpeg(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let best = null
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      for (let j = i + 2; j + 1 < bytes.length; j++) {
        if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
          const len = j + 2 - i
          if (!best || len > best.len) best = { start: i, len }
          i = j + 1
          break
        }
      }
    }
  }
  if (!best) throw new Error('No embedded preview found in this DNG — please upload a JPG')
  const jpeg = bytes.slice(best.start, best.start + best.len)
  return new File([jpeg], file.name.replace(/\.dng$/i, '.jpg'), { type: 'image/jpeg' })
}

async function prepareForUpload(file) {
  if (isHeic(file)) return heicToJpeg(file)
  if (isDng(file)) return dngToJpeg(file)
  return file
}

// Website gallery: photos uploaded here appear on the public Gallery page, in this order.
export default function Gallery() {
  const { data, error, loading, reload } = useApi('/admin/gallery')
  const [selected, setSelected] = useState(() => new Set())
  if (!data && loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  const shown = data.filter((p) => p.is_published).length
  const toggle = (photoId) => setSelected((s) => {
    const next = new Set(s)
    next.has(photoId) ? next.delete(photoId) : next.add(photoId)
    return next
  })
  const ids = [...selected].filter((x) => data.some((p) => p.id === x))

  return (
    <>
      <PageHeader
        title="Website gallery"
        intro={`Photos here appear on the website's Gallery page, in this order. ${shown} of ${data.length} shown.`}
      />
      <Uploader onUploaded={reload} />
      {data.length === 0
        ? <Notice>No photos yet. Upload some above.</Notice>
        : (
          <>
            <BulkBar
              ids={ids}
              total={data.length}
              onSelectAll={() => setSelected(new Set(ids.length === data.length ? [] : data.map((p) => p.id)))}
              onDone={() => { setSelected(new Set()); reload() }}
            />
            <div className="gal-admin">
              {data.map((p, i) => (
                <PhotoCard
                  key={p.id}
                  photo={p}
                  first={i === 0}
                  last={i === data.length - 1}
                  selected={selected.has(p.id)}
                  onSelect={() => toggle(p.id)}
                  onChange={reload}
                />
              ))}
            </div>
          </>
        )}
    </>
  )
}

// Bulk upload: drop or choose many photos; they upload a few at a time straight to storage.
function Uploader({ onUploaded }) {
  const [category, setCategory] = useState('classes')
  const [queue, setQueue] = useState([]) // { key, name, status: 'waiting'|'uploading'|'done'|'failed', error }
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  const busy = queue.some((q) => q.status === 'waiting' || q.status === 'uploading' || q.status === 'converting')

  const update = (key, patch) => setQueue((q) => q.map((item) => (item.key === key ? { ...item, ...patch } : item)))

  async function start(fileList) {
    const files = [...fileList]
    if (!files.length) return
    const items = files.map((file, i) => {
      const key = `${Date.now()}-${i}-${file.name}`
      // HEIC/DNG are converted to JPEG before upload, so the size cap is checked on the result.
      const convertible = isConvertible(file)
      const problem = !TYPES.includes(file.type) && !convertible
        ? 'Not a JPG, PNG, WebP, HEIC or DNG image'
        : !convertible && file.size > MAX_BYTES ? 'Larger than 10 MB' : null
      return { key, file, name: file.name, status: problem ? 'failed' : 'waiting', error: problem }
    })
    setQueue((q) => [...q.filter((x) => x.status !== 'done'), ...items.map(({ file, ...rest }) => rest)])

    const todo = items.filter((x) => x.status === 'waiting')
    let next = 0
    async function worker() {
      while (next < todo.length) {
        const item = todo[next++]
        update(item.key, { status: isConvertible(item.file) ? 'converting' : 'uploading' })
        try {
          const file = await prepareForUpload(item.file)
          if (file.size > MAX_BYTES) throw new Error('Converted image is larger than 10 MB')
          update(item.key, { status: 'uploading' })
          const fileId = await uploadFile(file, 'gallery_photo')
          const caption = item.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
          await api('/admin/gallery', { method: 'POST', body: { fileId, category, caption } })
          update(item.key, { status: 'done' })
        } catch (err) {
          update(item.key, { status: 'failed', error: err.message })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker))
    onUploaded()
  }

  const done = queue.filter((q) => q.status === 'done').length
  const failed = queue.filter((q) => q.status === 'failed')

  return (
    <div className="panel a-stack" style={{ marginBottom: 'var(--space-5)' }}>
      <Field label="Category for new photos">
        <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
          {Object.entries(galleryCategories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>

      <div
        className={`gal-drop${dragging ? ' is-over' : ''}${busy ? ' is-busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) start(e.dataTransfer.files) }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></svg>
        <p><strong>Drag photos here</strong> or</p>
        <button type="button" className="a-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? `Uploading… ${done} of ${queue.length - failed.length} done` : 'Choose photos'}
        </button>
        <p className="a-meta">Select as many as you like. JPG, PNG, WebP, HEIC or DNG, up to 10 MB each (HEIC/DNG are converted to JPG automatically). New photos go to the top.</p>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept={[...TYPES, 'image/heic', 'image/heif', '.heic', '.heif', 'image/x-adobe-dng', '.dng'].join(',')}
          onChange={(e) => { start(e.target.files); e.target.value = '' }}
        />
      </div>

      {queue.length > 0 && (
        <div className="gal-queue">
          <div className="a-row" style={{ justifyContent: 'space-between' }}>
            <span className="a-meta">
              {done} uploaded{failed.length ? ` · ${failed.length} failed` : ''}{busy ? ' · working…' : ''}
            </span>
            {!busy && <button type="button" className="a-link" onClick={() => setQueue([])}>Clear list</button>}
          </div>
          <div className="gal-queue__bar" aria-hidden="true">
            <span style={{ width: `${Math.round(((done + failed.length) / queue.length) * 100)}%` }} />
          </div>
          <ul>
            {queue.map((q) => (
              <li key={q.key} className={`gal-queue__item is-${q.status}`}>
                <span className="gal-queue__name">{q.name}</span>
                <span className="gal-queue__status">
                  {q.status === 'waiting' && 'Waiting'}
                  {q.status === 'converting' && 'Converting…'}
                  {q.status === 'uploading' && 'Uploading…'}
                  {q.status === 'done' && 'Uploaded'}
                  {q.status === 'failed' && (q.error || 'Failed')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Actions for the selected photos.
function BulkBar({ ids, total, onSelectAll, onDone }) {
  const action = useAction()
  const [category, setCategory] = useState('')
  const run = async (body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    if (await action.run(() => api('/admin/gallery/bulk', { method: 'POST', body: { ids, ...body } }))) {
      setCategory('')
      onDone()
    }
  }
  const none = ids.length === 0 || action.busy

  return (
    <div className="gal-bulk">
      <label className="a-check">
        <input type="checkbox" checked={ids.length > 0 && ids.length === total} ref={(el) => { if (el) el.indeterminate = ids.length > 0 && ids.length < total }} onChange={onSelectAll} />
        <span>{ids.length ? `${ids.length} selected` : 'Select all'}</span>
      </label>
      <div className="gal-bulk__actions">
        <button type="button" className="a-btn a-btn--ghost a-btn--sm" disabled={none} onClick={() => run({ action: 'show' })}>Show</button>
        <button type="button" className="a-btn a-btn--ghost a-btn--sm" disabled={none} onClick={() => run({ action: 'hide' })}>Hide</button>
        <select
          className="gal-bulk__select"
          value={category}
          disabled={none}
          aria-label="Move selected to category"
          onChange={(e) => { setCategory(e.target.value); if (e.target.value) run({ action: 'category', category: e.target.value }) }}
        >
          <option value="">Move to category…</option>
          {Object.entries(galleryCategories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button
          type="button"
          className="a-btn a-btn--ghost a-btn--sm gal-admin__delete"
          disabled={none}
          onClick={() => run({ action: 'delete' }, `Delete ${ids.length} photo${ids.length === 1 ? '' : 's'} from the website gallery? This cannot be undone.`)}
        >
          Delete
        </button>
      </div>
      {action.error && <span className="a-field__error">{action.error.message}</span>}
    </div>
  )
}

function PhotoCard({ photo: p, first, last, selected, onSelect, onChange }) {
  const action = useAction()
  const [caption, setCaption] = useState(p.caption ?? '')
  const save = (body) => action.run(() => api(`/admin/gallery/${p.id}`, { method: 'PATCH', body })).then((ok) => ok && onChange())
  const move = (direction) => action.run(() => api(`/admin/gallery/${p.id}/move`, { method: 'POST', body: { direction } })).then((ok) => ok && onChange())
  async function remove() {
    if (!window.confirm('Delete this photo from the website gallery? This cannot be undone.')) return
    if (await action.run(() => api(`/admin/gallery/${p.id}`, { method: 'DELETE' }))) onChange()
  }

  return (
    <article className={`gal-admin__card${p.is_published ? '' : ' is-hidden'}${selected ? ' is-selected' : ''}`}>
      <div className="gal-admin__media">
        <img src={p.src} alt={p.caption || 'Gallery photo'} loading="lazy" />
        <label className="gal-admin__pick">
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${p.caption || 'photo'}`} />
        </label>
        {!p.is_published && <span className="gal-admin__flag"><Badge status="draft">Hidden</Badge></span>}
      </div>
      <div className="gal-admin__body">
        <Field label="Caption">
          <input
            value={caption}
            maxLength={200}
            placeholder="Describe the photo"
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => caption !== (p.caption ?? '') && save({ caption })}
          />
        </Field>
        <Field label="Category">
          <select value={p.category} onChange={(e) => save({ category: e.target.value })} disabled={action.busy}>
            {Object.entries(galleryCategories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="gal-admin__actions">
          <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => move('up')} disabled={first || action.busy} aria-label="Move earlier">↑</button>
          <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => move('down')} disabled={last || action.busy} aria-label="Move later">↓</button>
          <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => save({ isPublished: !p.is_published })} disabled={action.busy}>
            {p.is_published ? 'Hide' : 'Show'}
          </button>
          <button type="button" className="a-btn a-btn--ghost a-btn--sm gal-admin__delete" onClick={remove} disabled={action.busy}>Delete</button>
        </div>
        {action.error && <span className="a-field__error">{action.error.message}</span>}
      </div>
    </article>
  )
}
