import { useState } from 'react'
import { useApi } from '../lib/useApi.js'
import { api, fetchFile } from '../lib/api.js'
import { date, dateTime, fileSize } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Badge, Modal, Field, Checkbox, ProgrammeSelect, CohortSelect, CourseSelect, Tabs, useAction } from '../components/ui.jsx'

// Learning materials and assignments with marking (spec §8.5).
export default function Learning() {
  const [tab, setTab] = useState('materials')
  return (
    <>
      <PageHeader title="Materials & assignments" />
      <Tabs tabs={[['materials', 'Learning materials'], ['assignments', 'Assignments & projects']]} value={tab} onChange={setTab} />
      {tab === 'materials' ? <Materials /> : <Assignments />}
    </>
  )
}

function Materials() {
  const { data, error, loading, reload } = useApi('/admin/materials')
  const [adding, setAdding] = useState(false)
  const action = useAction()
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <>
      <div className="a-row" style={{ marginBottom: 'var(--space-3)' }}><button type="button" className="a-btn" onClick={() => setAdding(true)}>Add material</button></div>
      <ErrorBox error={action.error} />
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Title</th><th>Visible to</th><th>Course</th><th>File / link</th><th>Added</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.length === 0 && <tr><td colSpan={7} className="a-empty">No materials yet. Upload handbooks, workbooks and recipes for students to download.</td></tr>}
            {data.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.title}</strong>{m.description && <div className="a-meta">{m.description}</div>}</td>
                <td>{m.cohort_name ?? m.programme_name ?? 'All students'}</td>
                <td>{m.course_name ?? '—'}</td>
                <td>{m.filename ? <button type="button" className="a-link" onClick={() => fetchFile(`/admin/materials/${m.id}/download`)}>{m.filename}</button> : <a href={m.url} target="_blank" rel="noreferrer">Link</a>}{m.size_bytes && <div className="a-meta">{fileSize(m.size_bytes)}</div>}</td>
                <td className="nowrap">{date(m.created_at)}</td>
                <td>
                  <button type="button" className="a-link" onClick={async () => { if (await action.run(() => api(`/admin/materials/${m.id}`, { method: 'PATCH', body: { isPublished: !m.is_published } }))) reload() }}>
                    {m.is_published ? <Badge status="published" /> : <Badge status="draft">Hidden</Badge>}
                  </button>
                </td>
                <td><button type="button" className="a-link" onClick={async () => { if (window.confirm(`Delete "${m.title}"?`) && (await action.run(() => api(`/admin/materials/${m.id}`, { method: 'DELETE' })))) reload() }}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <MaterialModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} />}
    </>
  )
}

function MaterialModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ title: '', description: '', programmeId: '', cohortId: '', courseId: '', url: '', isPublished: true })
  const [file, setFile] = useState(null)
  const action = useAction()
  async function save() {
    const fd = new FormData()
    for (const [k, v] of Object.entries(form)) fd.append(k, String(v ?? ''))
    if (file) fd.append('file', file)
    if (await action.run(() => api('/admin/materials', { method: 'POST', form: fd }))) onSaved()
  }
  return (
    <Modal title="Add learning material" onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <Field label="Title" required error={action.errors.title}><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Description"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="a-form__row">
          <Field label="Programme" hint="Blank = all students"><ProgrammeSelect value={form.programmeId} onChange={(v) => setForm({ ...form, programmeId: v, cohortId: '' })} allowEmpty="All programmes" className="" /></Field>
          <Field label="Only this cohort"><CohortSelect value={form.cohortId} onChange={(v) => setForm({ ...form, cohortId: v })} programmeId={form.programmeId} allowEmpty="Any cohort" className="" /></Field>
        </div>
        <Field label="Course"><CourseSelect value={form.courseId} onChange={(v) => setForm({ ...form, courseId: v })} programmeId={form.programmeId} allowEmpty="General" className="" /></Field>
        <Field label="File" hint="PDF, Word, Excel, PowerPoint or images — max 5 MB."><input type="file" onChange={(e) => setFile(e.target.files[0] ?? null)} /></Field>
        <Field label="…or a link (video, Google Drive, YouTube)" error={action.errors.url}><input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" /></Field>
        <Checkbox label="Visible to students now" checked={form.isPublished} onChange={(v) => setForm({ ...form, isPublished: v })} />
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy || !form.title || (!file && !form.url)} onClick={save}>{action.busy ? 'Uploading…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  )
}

function Assignments() {
  const [cohortId, setCohortId] = useState('')
  const { data, error, loading, reload } = useApi(`/admin/assignments${cohortId ? `?cohortId=${cohortId}` : ''}`)
  const [editing, setEditing] = useState(null)
  const [marking, setMarking] = useState(null)
  return (
    <>
      <div className="a-filters">
        <CohortSelect value={cohortId} onChange={setCohortId} />
        <button type="button" className="a-btn" onClick={() => setEditing({ cohort_id: cohortId })}>New assignment</button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Assignment</th><th>Cohort</th><th>Due</th><th className="num">Submitted</th><th className="num">To mark</th><th /></tr></thead>
            <tbody>
              {data.length === 0 && <tr><td colSpan={6} className="a-empty">No assignments.</td></tr>}
              {data.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.title}</strong><div className="a-meta">{a.course_name ?? 'General'}</div></td>
                  <td>{a.cohort_name}</td>
                  <td className="nowrap">{dateTime(a.due_at)}</td>
                  <td className="num">{a.submissions}/{a.cohort_size}</td>
                  <td className="num">{a.unmarked ? <Badge status="pending">{a.unmarked}</Badge> : 0}</td>
                  <td className="nowrap">
                    <button type="button" className="a-btn a-btn--sm" onClick={() => setMarking(a)}>Submissions</button>{' '}
                    <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setEditing(a)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <AssignmentModal a={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {marking && <SubmissionsModal assignment={marking} onClose={() => { setMarking(null); reload() }} />}
    </>
  )
}

const toLocalInput = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

function AssignmentModal({ a, onClose, onSaved }) {
  const [form, setForm] = useState({ cohortId: a.cohort_id ?? '', courseId: a.course_id ?? '', title: a.title ?? '', description: a.description ?? '', dueAt: toLocalInput(a.due_at) })
  const action = useAction()
  const body = { ...form, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null }
  return (
    <Modal title={a.id ? 'Edit assignment' : 'New assignment'} onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <Field label="Cohort" required error={action.errors.cohortId}><CohortSelect value={form.cohortId} onChange={(v) => setForm({ ...form, cohortId: v })} allowEmpty="Select…" className="" /></Field>
        <Field label="Course"><CourseSelect value={form.courseId} onChange={(v) => setForm({ ...form, courseId: v })} allowEmpty="General" className="" /></Field>
        <Field label="Title" required error={action.errors.title}><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Instructions"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Due" error={action.errors.dueAt}><input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field>
        <div className="a-form__foot">
          {a.id && <button type="button" className="a-btn a-btn--danger" style={{ marginRight: 'auto' }} onClick={async () => { if (window.confirm('Delete this assignment and all submissions?') && (await action.run(() => api(`/admin/assignments/${a.id}`, { method: 'DELETE' })))) onSaved() }}>Delete</button>}
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy} onClick={async () => { if (await action.run(() => (a.id ? api(`/admin/assignments/${a.id}`, { method: 'PUT', body }) : api('/admin/assignments', { method: 'POST', body })))) onSaved() }}>Save</button>
        </div>
      </div>
    </Modal>
  )
}

function SubmissionsModal({ assignment, onClose }) {
  const { data, error, loading, reload } = useApi(`/admin/assignments/${assignment.id}/submissions`)
  return (
    <Modal title={`Submissions · ${assignment.title}`} onClose={onClose} wide>
      {loading ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <div className="a-stack">
          {data.rows.map((r) => <SubmissionRow key={r.student_id} r={r} onSaved={reload} />)}
        </div>
      )}
    </Modal>
  )
}

function SubmissionRow({ r, onSaved }) {
  const [form, setForm] = useState({ feedback: r.feedback ?? '', score: r.score ?? '' })
  const action = useAction()
  return (
    <div className="panel" style={{ padding: 'var(--space-3)' }}>
      <div className="a-row" style={{ justifyContent: 'space-between' }}>
        <strong>{r.first_name} {r.last_name} <span className="a-meta">{r.student_number}</span></strong>
        {r.id ? <Badge status={r.reviewed_at ? 'completed' : 'pending'}>{r.reviewed_at ? 'Marked' : `Submitted ${dateTime(r.submitted_at)}`}</Badge> : <Badge status="cancelled">Not submitted</Badge>}
      </div>
      {r.id && (
        <div className="a-form" style={{ marginTop: 'var(--space-2)' }}>
          {r.note && <p>{r.note}</p>}
          {r.filename && <button type="button" className="a-link" onClick={() => fetchFile(`/admin/submissions/${r.id}/file`)}>Download {r.filename}</button>}
          <ErrorBox error={action.error} />
          <div className="a-form__row" style={{ alignItems: 'end' }}>
            <Field label="Feedback"><input value={form.feedback} onChange={(e) => setForm({ ...form, feedback: e.target.value })} /></Field>
            <Field label="Score (optional)"><input type="number" min="0" max="100" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} /></Field>
            <button type="button" className="a-btn a-btn--sm" disabled={action.busy} onClick={async () => { if (await action.run(() => api(`/admin/submissions/${r.id}`, { method: 'PATCH', body: { feedback: form.feedback, score: form.score === '' ? null : form.score } }))) onSaved() }}>Save feedback</button>
          </div>
        </div>
      )}
    </div>
  )
}
