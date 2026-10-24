import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { date, humanize } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Badge, Modal, Field, Checkbox, CohortSelect, Tabs, useAction } from '../components/ui.jsx'

// Student requests (transcripts, letters, change of details) and course feedback (spec §8.5).
export default function Requests() {
  const [tab, setTab] = useState('requests')
  return (
    <>
      <PageHeader title="Requests & feedback" />
      <Tabs tabs={[['requests', 'Student requests'], ['feedback', 'Course feedback']]} value={tab} onChange={setTab} />
      {tab === 'requests' ? <RequestList /> : <Feedback />}
    </>
  )
}

function RequestList() {
  const [status, setStatus] = useState('')
  const { data, error, loading, reload } = useApi(`/admin/requests${status ? `?status=${status}` : ''}`)
  const [open, setOpen] = useState(null)
  return (
    <>
      <div className="a-filters">
        <select className="a-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>{['open', 'in_progress', 'completed', 'rejected'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Date</th><th>Student</th><th>Request</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.length === 0 && <tr><td colSpan={5} className="a-empty">No requests.</td></tr>}
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{date(r.created_at)}</td>
                  <td><Link to={`/students/${r.student_id}`}>{r.first_name} {r.last_name}</Link><div className="a-meta">{r.student_number}</div></td>
                  <td><strong>{humanize(r.type)}</strong><div className="a-meta">{r.details.slice(0, 120)}{r.details.length > 120 ? '…' : ''}</div></td>
                  <td><Badge status={r.status} /></td>
                  <td><button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setOpen(r)}>Respond</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <RespondModal r={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload() }} />}
    </>
  )
}

function RespondModal({ r, onClose, onSaved }) {
  const [form, setForm] = useState({ status: r.status === 'open' ? 'in_progress' : r.status, response: r.response ?? '', notify: true })
  const action = useAction()
  return (
    <Modal title={`${humanize(r.type)} · ${r.first_name} ${r.last_name}`} onClose={onClose}>
      <div className="a-form">
        <p style={{ whiteSpace: 'pre-line' }}>{r.details}</p>
        <ErrorBox error={action.error} />
        <Field label="Status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{['open', 'in_progress', 'completed', 'rejected'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>
        <Field label="Response to student"><textarea value={form.response} onChange={(e) => setForm({ ...form, response: e.target.value })} /></Field>
        <Checkbox label="Email the student when completed or rejected" checked={form.notify} onChange={(v) => setForm({ ...form, notify: v })} />
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy} onClick={async () => { if (await action.run(() => api(`/admin/requests/${r.id}`, { method: 'PATCH', body: form }))) onSaved() }}>Save</button>
        </div>
      </div>
    </Modal>
  )
}

function Feedback() {
  const [cohortId, setCohortId] = useState('')
  const { data, error, loading, reload } = useApi(`/admin/feedback${cohortId ? `?cohortId=${cohortId}` : ''}`)
  return (
    <>
      <div className="a-filters"><CohortSelect value={cohortId} onChange={setCohortId} /></div>
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : (
        <div className="a-stack">
          <div className="kpis">
            {data.summary.map((s) => <div key={s.course_name} className="panel"><div className="panel__label">{s.course_name}</div><div className="panel__value">{s.average.toFixed(1)} ★</div><div className="a-meta">{s.responses} responses</div></div>)}
          </div>
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>Date</th><th>Course</th><th>Cohort</th><th>Rating</th><th>Comments</th></tr></thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan={5} className="a-empty">No feedback yet.</td></tr>}
                {data.rows.map((f) => <tr key={f.id}><td className="nowrap">{date(f.created_at)}</td><td>{f.course_name ?? 'General'}</td><td>{f.cohort_name ?? '—'}</td><td>{'★'.repeat(f.rating)}</td><td>{f.comments ?? '—'}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
