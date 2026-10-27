'use client'
import { useState } from 'react'
import { galleryCategories } from '@cca/shared/gallery'
import { useApi } from '../lib/useApi.js'
import { api, uploadFile } from '../lib/api.js'
import { PageHeader, Loading, ErrorBox, Badge, Field, Notice, useAction } from '../components/ui.jsx'

// Website gallery: photos uploaded here appear on the public Gallery page, in this order.
export default function Gallery() {
  const { data, error, loading, reload } = useApi('/admin/gallery')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const shown = data.filter((p) => p.is_published).length
  return (
    <>
      <PageHeader
        title="Website gallery"
        intro={`Photos here appear on the website's Gallery page, in this order. ${shown} of ${data.length} shown.`}
      />
      <Uploader onDone={reload} />
      {data.length === 0
        ? <Notice>No photos yet. Upload some above.</Notice>
        : (
          <div className="gal-admin">
            {data.map((p, i) => <PhotoCard key={p.id} photo={p} first={i === 0} last={i === data.length - 1} onChange={reload} />)}
          </div>
        )}
    </>
  )
}

function Uploader({ onDone }) {
  const [category, setCategory] = useState('classes')
  const [progress, setProgress] = useState(null)
  const [failed, setFailed] = useState([])

  async function upload(files) {
    const list = [...files]
    if (!list.length) return
    const errors = []
    for (const [i, file] of list.entries()) {
      setProgress(`Uploading ${i + 1} of ${list.length}…`)
      try {
        const fileId = await uploadFile(file, 'gallery_photo')
        await api('/admin/gallery', { method: 'POST', body: { fileId, category, caption: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') } })
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`)
      }
    }
    setProgress(null)
    setFailed(errors)
    onDone()
  }

  return (
    <div className="panel a-stack" style={{ marginBottom: 'var(--space-5)' }}>
      <div className="a-row" style={{ alignItems: 'flex-end' }}>
        <Field label="Category for new photos">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(galleryCategories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <label className={`a-btn${progress ? ' is-busy' : ''}`} style={{ cursor: progress ? 'wait' : 'pointer' }}>
          {progress ?? 'Upload photos'}
          <input
            type="file"
            hidden
            multiple
            accept="image/jpeg,image/png,image/webp"
            disabled={Boolean(progress)}
            onChange={(e) => { upload(e.target.files); e.target.value = '' }}
          />
        </label>
      </div>
      <p className="a-meta">JPG, PNG or WebP, up to 10 MB each. You can choose several at once. New photos go to the top; edit captions below.</p>
      {failed.length > 0 && (
        <div className="a-alert a-alert--error" role="alert">
          <div className="a-alert__body">
            {failed.length === 1 ? 'One photo could not be uploaded:' : `${failed.length} photos could not be uploaded:`}
            <ul>{failed.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        </div>
      )}
    </div>
  )
}

function PhotoCard({ photo: p, first, last, onChange }) {
  const action = useAction()
  const [caption, setCaption] = useState(p.caption ?? '')
  const save = (body) => action.run(() => api(`/admin/gallery/${p.id}`, { method: 'PATCH', body })).then((ok) => ok && onChange())
  const move = (direction) => action.run(() => api(`/admin/gallery/${p.id}/move`, { method: 'POST', body: { direction } })).then((ok) => ok && onChange())
  async function remove() {
    if (!window.confirm('Delete this photo from the website gallery? This cannot be undone.')) return
    if (await action.run(() => api(`/admin/gallery/${p.id}`, { method: 'DELETE' }))) onChange()
  }

  return (
    <article className={`gal-admin__card${p.is_published ? '' : ' is-hidden'}`}>
      <div className="gal-admin__media">
        <img src={p.src} alt={p.caption || 'Gallery photo'} loading="lazy" />
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
