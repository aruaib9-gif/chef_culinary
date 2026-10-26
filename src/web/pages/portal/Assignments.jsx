'use client'
import { useState } from 'react'
import { useApi } from '../../lib/useApi.js'
import { api, fetchFile, uploadFile } from '../../lib/api.js'
import { dateTime } from '../../lib/format.js'
import { PageHead, Loading, ErrorBox, Empty, Badge, Field, Notice } from '../../components/portal/ui.jsx'

// Assignment and project submission with photos/files and instructor feedback (spec §8.5).
export default function Assignments() {
  const { data, error, loading, reload } = useApi('/student/assignments')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <div className="portal-page">
      <PageHead title="Assignments & projects" intro="Submit your work as photos, PDFs or documents (max 10 MB each)." />
      {data.length === 0 ? <Empty title="No assignments yet">Assignments set by your instructors will appear here.</Empty> : (
        <div className="p-list">{data.map((a) => <AssignmentCard key={a.id} a={a} onSaved={reload} />)}</div>
      )}
    </div>
  )
}

function AssignmentCard({ a, onSaved }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(a.note ?? '')
  const [file, setFile] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const closed = a.due_at && new Date(a.due_at) < new Date()
  const status = a.reviewed_at ? 'completed' : a.submission_id ? 'success' : closed ? 'overdue' : 'due'
  const label = a.reviewed_at ? 'Marked' : a.submission_id ? 'Submitted' : closed ? 'Closed' : 'To do'

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const fileId = file ? await uploadFile(file, 'submission') : null
      await api(`/student/assignments/${a.id}/submit`, { method: 'POST', body: { note, ...(fileId ? { fileId } : {}) } })
      setOpen(false)
      setFile(null)
      onSaved()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <div className="portal-head--row">
        <div>
          <div className="p-list-item__title">{a.title}</div>
          <div className="p-list-item__meta">{a.course_name ?? 'General'}{a.due_at ? ` · Due ${dateTime(a.due_at)}` : ''}</div>
        </div>
        <Badge status={status}>{label}</Badge>
      </div>
      {a.description && <p style={{ whiteSpace: 'pre-line' }}>{a.description}</p>}
      {a.submission_id && (
        <div className="p-list-item__meta">
          Submitted {dateTime(a.submitted_at)}
          {a.filename && <> · <button type="button" className="p-link-btn" onClick={() => fetchFile(`/student/submissions/${a.submission_id}/file`)}>{a.filename}</button></>}
        </div>
      )}
      {a.reviewed_at && (
        <Notice tone="success">
          <span><strong>Instructor feedback{a.score != null ? ` · Score ${a.score}` : ''}:</strong> {a.feedback || 'No comments.'}</span>
        </Notice>
      )}
      {!a.reviewed_at && !closed && (
        open ? (
          <form className="p-form" onSubmit={submit}>
            <ErrorBox error={error} />
            <Field label="Note to instructor (optional)"><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={3000} /></Field>
            <Field label={a.submission_id ? 'Replace file (optional)' : 'Upload file'} hint="JPG, PNG, WebP, PDF, Word, Excel or PowerPoint. Max 10 MB.">
              <input type="file" accept="image/*,.pdf,.doc,.docx,.xlsx,.pptx" onChange={(e) => setFile(e.target.files[0] ?? null)} />
            </Field>
            <div className="p-form__actions">
              <button type="submit" className="p-btn p-btn--primary" disabled={busy || (!file && !note)}>{busy ? 'Uploading…' : 'Submit'}</button>
              <button type="button" className="p-btn" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <div><button type="button" className="p-btn p-btn--primary" onClick={() => setOpen(true)}>{a.submission_id ? 'Update submission' : 'Submit work'}</button></div>
        )
      )}
    </div>
  )
}
