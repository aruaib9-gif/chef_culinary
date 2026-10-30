'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import NextLink from 'next/link'
import { Link, useNavigate, useParams } from '@/lib/router'
import VideoPlayer from '@/web/components/VideoPlayer.jsx'
import { useApi } from '../lib/useApi.js'
import { api, uploadFile, uploadLargeFile } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { money, date, dateTime, fileSize } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Badge, Modal, Field, Tabs, Notice, useAction } from '../components/ui.jsx'

const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const MAX_VIDEO = 5 * 1024 * 1024 * 1024
const clock = (s) => (s ? `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—')
// "Lesson 2 - Samosa.mp4" → "Samosa" (lessons are numbered on screen already).
const titleFromFile = (name) => {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return base.replace(/^(lesson|lecture|part|episode|ep|video|module)?\s*\d+\s*[-.:)]*\s*/i, '').replace(/\s-\s/g, ' – ') || base
}

// ── Course list ──────────────────────────────────────────────────────────────

export default function OnlineCourses() {
  const { data, error, loading, reload } = useApi('/admin/videos/courses')
  const { user } = useAuth()
  const [creating, setCreating] = useState(false)
  const action = useAction()
  const isSuper = user?.role === 'super_admin'
  if (!data && loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  const move = (c, direction) => action.run(() => api(`/admin/videos/courses/${c.id}/move`, { method: 'POST', body: { direction } })).then((ok) => ok && reload())

  return (
    <>
      <PageHeader
        title="Online courses"
        intro="Recorded video courses that anyone with a website account can buy and watch. Videos stream from private storage and can't be downloaded from the site."
        actions={<button type="button" className="a-btn" onClick={() => setCreating(true)}>New course</button>}
      />
      <ErrorBox error={action.error} />
      {data.length === 0 ? (
        <Notice>No online courses yet. Create one, then upload its lesson videos.</Notice>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Course</th><th className="num">Price</th><th className="num">Lessons</th><th className="num">Learners</th>
                {isSuper && <th className="num">Sales</th>}
                <th>Website</th><th>Order</th><th />
              </tr>
            </thead>
            <tbody>
              {data.map((c, i) => (
                <tr key={c.id}>
                  <td>
                    <div className="vid-row">
                      {c.cover_url ? <img className="vid-thumb" src={c.cover_url} alt="" /> : <span className="vid-thumb vid-thumb--empty" aria-hidden="true">▶</span>}
                      <div><strong>{c.title}</strong><div className="a-meta">/portal/videos/{c.slug}</div></div>
                    </div>
                  </td>
                  <td className="num">{c.price_kobo ? money(c.price_kobo) : 'Free'}{c.access_days && <div className="a-meta">{c.access_days} days' access</div>}</td>
                  <td className="num">{c.lessons}{c.seconds > 0 && <div className="a-meta">{clock(c.seconds)}</div>}</td>
                  <td className="num">{c.learners}</td>
                  {isSuper && <td className="num">{c.sales}<div className="a-meta">{money(c.revenue_kobo)}</div></td>}
                  <td><PublishBadge course={c} />{c.publish_state === 'scheduled' && <div className="a-meta">{dateTime(c.publish_at)}</div>}</td>
                  <td>
                    <div className="a-row" style={{ gap: 4 }}>
                      <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => move(c, 'up')} disabled={i === 0 || action.busy} aria-label="Move up">↑</button>
                      <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => move(c, 'down')} disabled={i === data.length - 1 || action.busy} aria-label="Move down">↓</button>
                    </div>
                  </td>
                  <td><Link to={`/online-courses/${c.id}`} className="a-btn a-btn--ghost a-btn--sm">Manage</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewCourse isSuper={isSuper} onClose={() => setCreating(false)} />}
    </>
  )
}

function NewCourse({ isSuper, onClose }) {
  const navigate = useNavigate()
  const action = useAction()
  const [form, setForm] = useState({ title: '', summary: '', price: '', accessDays: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  async function submit(e) {
    e.preventDefault()
    const course = await action.run(() => api('/admin/videos/courses', {
      method: 'POST',
      body: { title: form.title, summary: form.summary, priceKobo: Math.round(Number(form.price || 0) * 100), accessDays: form.accessDays, isPublished: false },
    }))
    if (course) navigate(`/online-courses/${course.id}`)
  }
  return (
    <Modal title="New online course" onClose={onClose}>
      <form className="a-form" onSubmit={submit}>
        <Field label="Title" required error={action.errors.title}><input value={form.title} onChange={set('title')} maxLength={160} required /></Field>
        <Field label="Short summary" hint="One or two sentences shown on the course card"><textarea value={form.summary} onChange={set('summary')} maxLength={300} rows={2} /></Field>
        <div className="a-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Price (₦)" hint={isSuper ? 'What the learner pays. 0 or blank = free' : 'Only a super admin can set prices'}>
            <input type="number" min="0" step="1" value={form.price} onChange={set('price')} disabled={!isSuper} />
          </Field>
          <Field label="Access period (days)" hint="Blank = lifetime access"><input type="number" min="1" value={form.accessDays} onChange={set('accessDays')} disabled={!isSuper} /></Field>
        </div>
        <p className="a-meta">The course starts as a draft. Add lessons, then publish it now or schedule a date.</p>
        {action.error && <Notice tone="error">{action.error.message}</Notice>}
        <div className="a-actions"><button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button><button className="a-btn" disabled={action.busy}>{action.busy ? 'Creating…' : 'Create course'}</button></div>
      </form>
    </Modal>
  )
}

// ── One course ───────────────────────────────────────────────────────────────

export function OnlineCourseDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const { data, error, loading, reload } = useApi(`/admin/videos/courses/${id}`)
  const [tab, setTab] = useState('lessons')
  const isSuper = user?.role === 'super_admin'
  if (!data && loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  const tabs = [['lessons', `Lessons (${data.lessons.length})`], ['details', 'Details'], ['learners', 'Learners'], ...(isSuper ? [['orders', 'Payments']] : [])]
  return (
    <>
      <PageHeader
        title={data.title}
        intro={<><Link to="/online-courses">← All online courses</Link> · {data.price_kobo ? money(data.price_kobo) : 'Free'}</>}
        actions={<NextLink className="a-btn a-btn--ghost" href={`/portal/videos/${data.slug}`} target="_blank">View as learner</NextLink>}
      />
      <PublishBar course={data} onChange={reload} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'lessons' && <Lessons course={data} onChange={reload} />}
      {tab === 'details' && <Details course={data} isSuper={isSuper} onChange={reload} />}
      {tab === 'learners' && <Learners course={data} isSuper={isSuper} />}
      {tab === 'orders' && <Orders course={data} />}
    </>
  )
}

// Lessons: bulk-add videos (each becomes a lesson), edit, reorder, preview, replace or delete.
function Lessons({ course, onChange }) {
  const [queue, setQueue] = useState([]) // { key, name, size, progress, status, error }
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState(null)
  const [previewing, setPreviewing] = useState(null)
  const inputRef = useRef(null)
  const cancelRef = useRef(null)
  const action = useAction()
  const busy = queue.some((q) => q.status === 'waiting' || q.status === 'uploading')

  // Leaving the page would abandon an upload.
  useEffect(() => {
    if (!busy) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const update = (key, patch) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...patch } : x)))

  // One video at a time (each already uploads in parallel parts).
  async function start(fileList) {
    const items = [...fileList].map((file, i) => {
      const problem = !VIDEO_TYPES.includes(file.type) ? 'Not an MP4, WebM or MOV video' : file.size > MAX_VIDEO ? 'Larger than 5 GB' : null
      return { key: `${Date.now()}-${i}`, file, name: file.name, size: file.size, progress: 0, status: problem ? 'failed' : 'waiting', error: problem }
    })
    if (!items.length) return
    setQueue((q) => [...q.filter((x) => x.status !== 'done'), ...items.map(({ file, ...rest }) => rest)])
    for (const item of items.filter((x) => x.status === 'waiting')) {
      const controller = new AbortController()
      cancelRef.current = { key: item.key, controller }
      update(item.key, { status: 'uploading' })
      try {
        const fileId = await uploadLargeFile(item.file, 'training_video', { signal: controller.signal, onProgress: (p) => update(item.key, { progress: p }) })
        await api(`/admin/videos/courses/${course.id}/lessons`, { method: 'POST', body: { title: titleFromFile(item.name), fileId } })
        update(item.key, { status: 'done', progress: 1 })
        onChange()
      } catch (err) {
        update(item.key, { status: 'failed', error: err.message })
      }
    }
    cancelRef.current = null
  }

  const run = (fn) => action.run(fn).then((ok) => ok && onChange())
  const move = (l, direction) => run(() => api(`/admin/videos/lessons/${l.id}/move`, { method: 'POST', body: { direction } }))
  const toggle = (l, field, value) => run(() => api(`/admin/videos/lessons/${l.id}`, { method: 'PATCH', body: { [field]: value } }))
  const remove = (l) => window.confirm(`Delete the lesson "${l.title}" and its video? This cannot be undone.`) && run(() => api(`/admin/videos/lessons/${l.id}`, { method: 'DELETE' }))

  const done = queue.filter((q) => q.status === 'done').length
  return (
    <div className="a-stack">
      <div
        className={`gal-drop${dragging ? ' is-over' : ''}${busy ? ' is-busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) start(e.dataTransfer.files) }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></svg>
        <p><strong>Drag lesson videos here</strong> or</p>
        <button type="button" className="a-btn" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? 'Uploading…' : 'Choose videos'}</button>
        <p className="a-meta">Each video becomes a lesson, titled from its file name. MP4 (H.264) plays on every device; up to 5 GB each. Keep this page open until uploads finish.</p>
        <input ref={inputRef} type="file" hidden multiple accept={VIDEO_TYPES.join(',')} onChange={(e) => { start(e.target.files); e.target.value = '' }} />
      </div>

      {queue.length > 0 && (
        <div className="gal-queue">
          <div className="a-row" style={{ justifyContent: 'space-between' }}>
            <span className="a-meta">{done} of {queue.length} uploaded{busy ? ' · working…' : ''}</span>
            {!busy && <button type="button" className="a-link" onClick={() => setQueue([])}>Clear list</button>}
          </div>
          <ul>
            {queue.map((q) => (
              <li key={q.key} className={`gal-queue__item is-${q.status}`}>
                <span className="gal-queue__name">{q.name} <span className="a-meta">({fileSize(q.size)})</span></span>
                <span className="gal-queue__status">
                  {q.status === 'waiting' && 'Waiting'}
                  {q.status === 'uploading' && (
                    <span className="vid-progress">
                      <span className="gal-queue__bar" aria-hidden="true"><span style={{ width: `${Math.round(q.progress * 100)}%` }} /></span>
                      {Math.round(q.progress * 100)}%
                      <button type="button" className="a-link" onClick={() => cancelRef.current?.key === q.key && cancelRef.current.controller.abort()}>Cancel</button>
                    </span>
                  )}
                  {q.status === 'done' && 'Added'}
                  {q.status === 'failed' && (q.error || 'Failed')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ErrorBox error={action.error} />
      {course.lessons.length === 0 ? (
        <Notice>No lessons yet. Upload the course videos above.</Notice>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>#</th><th>Lesson</th><th className="num">Length</th><th>Free preview</th><th>Visible</th><th>Order</th><th /></tr></thead>
            <tbody>
              {course.lessons.map((l, i) => (
                <tr key={l.id}>
                  <td>{i + 1}</td>
                  <td>
                    <strong>{l.title}</strong>
                    <div className="a-meta">{l.file ? `${l.file.filename} · ${fileSize(l.file.size_bytes)}` : 'No video yet'}</div>
                  </td>
                  <td className="num">{clock(l.duration_seconds)}</td>
                  <td><input type="checkbox" checked={l.is_preview} onChange={(e) => toggle(l, 'isPreview', e.target.checked)} disabled={action.busy} aria-label={`Free preview: ${l.title}`} /></td>
                  <td><input type="checkbox" checked={l.is_published} onChange={(e) => toggle(l, 'isPublished', e.target.checked)} disabled={action.busy} aria-label={`Visible: ${l.title}`} /></td>
                  <td>
                    <div className="a-row" style={{ gap: 4 }}>
                      <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => move(l, 'up')} disabled={i === 0 || action.busy} aria-label="Move up">↑</button>
                      <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => move(l, 'down')} disabled={i === course.lessons.length - 1 || action.busy} aria-label="Move down">↓</button>
                    </div>
                  </td>
                  <td>
                    <div className="a-row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      {l.file && <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setPreviewing(l)}>Watch</button>}
                      <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setEditing(l)}>Edit</button>
                      <button type="button" className="a-btn a-btn--ghost a-btn--sm gal-admin__delete" onClick={() => remove(l)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="a-meta">Ticked “Free preview” lessons can be watched by anyone signed in, before buying. Lesson lengths fill in after the first play.</p>

      {editing && <EditLesson lesson={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange() }} />}
      {previewing && <PreviewLesson lesson={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  )
}

function EditLesson({ lesson, onClose, onSaved }) {
  const action = useAction()
  const [form, setForm] = useState({ title: lesson.title, description: lesson.description ?? '' })
  const [replacement, setReplacement] = useState(null)
  const [progress, setProgress] = useState(null)
  const controller = useRef(null)
  async function submit(e) {
    e.preventDefault()
    const ok = await action.run(async () => {
      let fileId
      if (replacement) {
        controller.current = new AbortController()
        fileId = await uploadLargeFile(replacement, 'training_video', { signal: controller.current.signal, onProgress: setProgress })
      }
      return api(`/admin/videos/lessons/${lesson.id}`, { method: 'PATCH', body: { ...form, ...(fileId ? { fileId } : {}) } })
    })
    if (ok) onSaved()
  }
  const close = () => { controller.current?.abort(); onClose() }
  return (
    <Modal title="Edit lesson" onClose={close}>
      <form className="a-form" onSubmit={submit}>
        <Field label="Title" required error={action.errors.title}><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={160} required /></Field>
        <Field label="Description" hint="Optional notes shown under the video"><textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={4000} /></Field>
        <Field label={lesson.file ? 'Replace video' : 'Video'} hint={lesson.file ? `Current: ${lesson.file.filename}` : 'MP4, WebM or MOV, up to 5 GB'}>
          <input type="file" accept={VIDEO_TYPES.join(',')} onChange={(e) => setReplacement(e.target.files[0] ?? null)} disabled={action.busy} />
        </Field>
        {progress != null && action.busy && (
          <div className="vid-progress"><span className="gal-queue__bar" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></span>{Math.round(progress * 100)}%</div>
        )}
        {action.error && <Notice tone="error">{action.error.message}</Notice>}
        <div className="a-actions">
          <button type="button" className="a-btn a-btn--ghost" onClick={close}>Cancel</button>
          <button className="a-btn" disabled={action.busy}>{action.busy ? (replacement ? 'Uploading…' : 'Saving…') : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ── Publishing ───────────────────────────────────────────────────────────────

const PUBLISH_LABELS = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published' }

function PublishBadge({ course }) {
  return <Badge status={course.publish_state}>{PUBLISH_LABELS[course.publish_state]}</Badge>
}

// <input type="datetime-local"> wants local time as "YYYY-MM-DDTHH:mm".
const toLocalInput = (d) => {
  const x = new Date(d)
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset())
  return x.toISOString().slice(0, 16)
}
const tomorrowAt9 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d }

/** Status of the course on the website, with the one or two things you can do next. */
function PublishBar({ course, onChange }) {
  const action = useAction()
  const [scheduling, setScheduling] = useState(false)
  const [when, setWhen] = useState('')
  const state = course.publish_state
  const readyLessons = course.lessons.filter((l) => l.is_published && l.file?.status === 'ready').length
  const missing = [
    !readyLessons && 'no visible lessons',
    !course.cover_url && 'no cover image',
    !course.summary && 'no short summary',
  ].filter(Boolean)

  const save = (body, message) => action.run(() => api(`/admin/videos/courses/${course.id}`, { method: 'PATCH', body }), message)
    .then((ok) => { if (ok) { setScheduling(false); onChange() } })

  function checkReady(verb) {
    return !missing.length || window.confirm(`This course has ${missing.join(', ')}. ${verb} anyway?`)
  }
  function publishNow() {
    if (checkReady('Publish')) save({ isPublished: true, publishAt: null }, 'Published. The course is now live on the website.')
  }
  function openSchedule() {
    setWhen(toLocalInput(state === 'scheduled' ? course.publish_at : tomorrowAt9()))
    action.reset()
    setScheduling(true)
  }
  function schedule(e) {
    e.preventDefault()
    const at = new Date(when)
    if (!(at > new Date())) return action.run(async () => { throw new Error('Pick a time in the future.') })
    if (checkReady('Schedule it')) save({ isPublished: true, publishAt: at.toISOString() }, `Scheduled for ${dateTime(at)}.`)
  }
  function unpublish() {
    const msg = state === 'scheduled'
      ? 'Cancel the schedule? The course goes back to draft.'
      : 'Unpublish this course? It disappears from the website, and learners who bought it can\'t open it until you publish it again.'
    if (window.confirm(msg)) save({ isPublished: false }, state === 'scheduled' ? 'Schedule cancelled. The course is a draft again.' : 'Unpublished. The course is hidden from the website.')
  }

  const status = {
    draft: 'Only admins can see this course.',
    scheduled: <>Goes live on the website on <strong>{dateTime(course.publish_at)}</strong>.</>,
    published: course.publish_at ? <>Live on the website since {dateTime(course.publish_at)}.</> : 'Live on the website.',
  }[state]

  return (
    <div className={`panel pub-bar pub-bar--${state}`}>
      <div className="pub-bar__main">
        <div className="pub-bar__status">
          <PublishBadge course={course} />
          <span>{status}</span>
        </div>
        {!scheduling && (
          <div className="pub-bar__actions">
            {state === 'published' ? (
              <button type="button" className="a-btn a-btn--ghost" onClick={unpublish} disabled={action.busy}>Unpublish</button>
            ) : (
              <>
                {state === 'scheduled'
                  ? <button type="button" className="a-btn a-btn--ghost" onClick={unpublish} disabled={action.busy}>Cancel schedule</button>
                  : null}
                <button type="button" className="a-btn a-btn--ghost" onClick={openSchedule} disabled={action.busy}>{state === 'scheduled' ? 'Change time' : 'Schedule'}</button>
                <button type="button" className="a-btn" onClick={publishNow} disabled={action.busy}>{action.busy ? 'Publishing…' : 'Publish now'}</button>
              </>
            )}
          </div>
        )}
      </div>
      {scheduling && (
        <form className="pub-bar__schedule" onSubmit={schedule}>
          <Field label="Go live on" hint="Your local time. The course appears on the website automatically at this time.">
            <input type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} required />
          </Field>
          <div className="pub-bar__actions">
            <button type="button" className="a-btn a-btn--ghost" onClick={() => setScheduling(false)} disabled={action.busy}>Cancel</button>
            <button className="a-btn" disabled={action.busy || !when}>{action.busy ? 'Scheduling…' : state === 'scheduled' ? 'Update schedule' : 'Schedule publish'}</button>
          </div>
        </form>
      )}
      {state !== 'published' && missing.length > 0 && !action.ok && (
        <p className="a-meta pub-bar__todo">Before publishing: this course has {missing.join(', ')}.</p>
      )}
      {action.error && <Notice tone="error">{action.error.message}</Notice>}
      {action.ok && <Notice tone="success">{action.ok}</Notice>}
    </div>
  )
}

function PreviewLesson({ lesson, onClose }) {
  const getSource = useCallback(() => api(`/admin/videos/lessons/${lesson.id}/play`, { method: 'POST' }), [lesson.id])
  return (
    <Modal title={lesson.title} onClose={onClose} wide>
      <VideoPlayer lessonId={lesson.id} title={lesson.title} watermark="Admin preview" getSource={getSource} />
    </Modal>
  )
}

function Details({ course, isSuper, onChange }) {
  const navigate = useNavigate()
  const action = useAction()
  const del = useAction()
  const [form, setForm] = useState({
    title: course.title, slug: course.slug, summary: course.summary ?? '', description: course.description ?? '',
    price: course.price_kobo ? String(course.price_kobo / 100) : '', accessDays: course.access_days ? String(course.access_days) : '',
  })
  const [cover, setCover] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const ok = await action.run(async () => {
      const coverFileId = cover ? await uploadFile(cover, 'video_cover') : undefined
      return api(`/admin/videos/courses/${course.id}`, {
        method: 'PATCH',
        body: {
          title: form.title, slug: form.slug, summary: form.summary, description: form.description,
          ...(isSuper ? { priceKobo: Math.round(Number(form.price || 0) * 100), accessDays: form.accessDays } : {}),
          ...(coverFileId ? { coverFileId } : {}),
        },
      })
    }, 'Saved')
    if (ok) { setCover(null); onChange() }
  }

  async function remove() {
    if (!window.confirm(`Delete "${course.title}", all its lessons and videos? This cannot be undone.`)) return
    if (await del.run(() => api(`/admin/videos/courses/${course.id}`, { method: 'DELETE' }))) navigate('/online-courses')
  }

  return (
    <div className="a-stack">
      <form className="panel a-form" onSubmit={submit}>
        <Field label="Title" required error={action.errors.title}><input value={form.title} onChange={set('title')} maxLength={160} required /></Field>
        <Field label="Web address" hint={`thechefsculinary.com/portal/videos/${form.slug || '…'}`}><input value={form.slug} onChange={set('slug')} maxLength={80} /></Field>
        <Field label="Short summary" hint="Shown on the course card"><textarea rows={2} value={form.summary} onChange={set('summary')} maxLength={300} /></Field>
        <Field label="About this course" hint="What learners will learn, who it's for, what they need"><textarea rows={6} value={form.description} onChange={set('description')} maxLength={8000} /></Field>
        <div className="a-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <Field label="Price (₦)" hint={isSuper ? '0 or blank = free for any signed-in account' : 'Only a super admin can change prices'}>
            <input type="number" min="0" step="1" value={form.price} onChange={set('price')} disabled={!isSuper} />
          </Field>
          <Field label="Access period (days)" hint="Blank = lifetime access"><input type="number" min="1" value={form.accessDays} onChange={set('accessDays')} disabled={!isSuper} /></Field>
        </div>
        <Field label="Cover image" hint="16:9 works best. JPG, PNG or WebP, up to 5 MB">
          <div className="vid-row">
            {course.cover_url && <img className="vid-thumb vid-thumb--lg" src={course.cover_url} alt="" />}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setCover(e.target.files[0] ?? null)} />
          </div>
        </Field>
        {action.error && <Notice tone="error">{action.error.message}</Notice>}
        {action.ok && <Notice tone="success">Saved.</Notice>}
        <div className="a-actions"><button className="a-btn" disabled={action.busy}>{action.busy ? 'Saving…' : 'Save changes'}</button></div>
      </form>

      <div className="panel a-stack">
        <h2 className="a-section-title">Delete course</h2>
        <p className="a-meta">Removes the course, every lesson video and all progress. Courses people have paid for can't be deleted; unpublish them instead.</p>
        {del.error && <Notice tone="error">{del.error.message}</Notice>}
        <div><button type="button" className="a-btn a-btn--danger" onClick={remove} disabled={del.busy}>Delete course</button></div>
      </div>
    </div>
  )
}

function Learners({ course, isSuper }) {
  const { data, error, loading, reload } = useApi(`/admin/videos/courses/${course.id}/learners`)
  const grant = useAction()
  const row = useAction()
  const [emailAddr, setEmailAddr] = useState('')
  if (!data && loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  async function give(e) {
    e.preventDefault()
    if (await grant.run(() => api(`/admin/videos/courses/${course.id}/learners`, { method: 'POST', body: { email: emailAddr } }), `Access given to ${emailAddr}`)) {
      setEmailAddr('')
      reload()
    }
  }
  const act = (r, what) => row.run(() => api(`/admin/videos/enrollments/${r.id}/${what}`, { method: 'POST' })).then((ok) => ok && reload())

  return (
    <div className="a-stack">
      {isSuper && (
        <form className="panel a-form" onSubmit={give}>
          <h2 className="a-section-title">Give access</h2>
          <p className="a-meta">For people who paid at the office or by bank transfer, or a scholarship. They need a website account first (they can sign up at /portal/signup).</p>
          <div className="a-row">
            <input className="a-input" type="email" required placeholder="their account email" value={emailAddr} onChange={(e) => setEmailAddr(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
            <button className="a-btn" disabled={grant.busy}>{grant.busy ? 'Giving access…' : 'Give access'}</button>
          </div>
          {grant.error && <Notice tone="error">{grant.error.message}</Notice>}
          {grant.ok && <Notice tone="success">{grant.ok}</Notice>}
        </form>
      )}
      {row.error && <Notice tone="error">{row.error.message}</Notice>}
      {data.length === 0 ? <Notice>No learners yet.</Notice> : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Learner</th><th>How</th><th>Progress</th><th>Since</th><th>Access</th>{isSuper && <th />}</tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.full_name || r.email}</strong><div className="a-meta">{r.email}{r.phone ? ` · ${r.phone}` : ''}</div></td>
                  <td>{{ purchase: 'Paid online', admin: 'Given by admin', free: 'Free course' }[r.source]}</td>
                  <td>{r.completed} / {r.lessons} lessons</td>
                  <td>{date(r.created_at)}</td>
                  <td><Badge status={r.status === 'active' ? 'active' : r.status === 'revoked' ? 'revoked' : 'cancelled'}>{r.status}</Badge>{r.expires_at && <div className="a-meta">until {date(r.expires_at)}</div>}</td>
                  {isSuper && (
                    <td>
                      {r.status === 'revoked'
                        ? <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => act(r, 'restore')} disabled={row.busy}>Restore</button>
                        : <button type="button" className="a-btn a-btn--ghost a-btn--sm gal-admin__delete" onClick={() => window.confirm(`Remove ${r.email}'s access to this course?`) && act(r, 'revoke')} disabled={row.busy}>Remove access</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Orders({ course }) {
  const { data, error, loading, reload } = useApi(`/admin/videos/courses/${course.id}/orders`)
  if (!data && loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const paid = data.filter((o) => o.status === 'success')
  return (
    <div className="a-stack">
      <p className="a-meta">{paid.length} paid · {money(paid.reduce((n, o) => n + o.amount_kobo, 0))} received online. Unfinished checkouts show as pending or cancelled.</p>
      {data.length === 0 ? <Notice>No online payments for this course yet.</Notice> : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Date</th><th>Buyer</th><th>Reference</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td>{dateTime(o.paid_at ?? o.created_at)}</td>
                  <td><strong>{o.full_name || o.email}</strong><div className="a-meta">{o.email}</div></td>
                  <td><code>{o.reference}</code>{o.channel && <div className="a-meta">{o.channel.replace(/_/g, ' ')}</div>}</td>
                  <td className="num">{money(o.amount_kobo)}</td>
                  <td><Badge status={o.status} />{o.notes && <div className="a-meta">{o.notes}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
