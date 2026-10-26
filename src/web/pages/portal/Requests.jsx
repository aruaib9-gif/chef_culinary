'use client'
import { useState } from 'react'
import { useApi } from '../../lib/useApi.js'
import { api } from '../../lib/api.js'
import { date, humanize } from '../../lib/format.js'
import { PageHead, Loading, ErrorBox, Badge, Field, Notice } from '../../components/portal/ui.jsx'

const TYPES = [
  ['transcript', 'Transcript request'],
  ['recommendation', 'Letter of recommendation'],
  ['change_of_details', 'Change of details (name, date of birth, programme…)'],
  ['other', 'Other'],
]

// Request forms and course evaluation (spec §8.5).
export default function Requests() {
  const [tab, setTab] = useState('requests')
  return (
    <div className="portal-page">
      <PageHead title="Requests & feedback" intro="Ask the academy for documents or changes, and tell us how your courses are going." />
      <div className="p-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'requests'} onClick={() => setTab('requests')}>Requests</button>
        <button type="button" role="tab" aria-selected={tab === 'feedback'} onClick={() => setTab('feedback')}>Course feedback</button>
      </div>
      {tab === 'requests' ? <RequestsTab /> : <FeedbackTab />}
    </div>
  )
}

function RequestsTab() {
  const { data, error, loading, reload } = useApi('/student/requests')
  const [form, setForm] = useState({ type: 'transcript', details: '' })
  const [state, setState] = useState({})

  async function submit(e) {
    e.preventDefault()
    setState({ busy: true })
    try {
      await api('/student/requests', { method: 'POST', body: form })
      setForm({ type: 'transcript', details: '' })
      setState({ done: true })
      reload()
    } catch (err) {
      setState({ error: err })
    }
  }

  return (
    <>
      <div className="card">
        <h2 className="portal-card-title">New request</h2>
        <form className="p-form" onSubmit={submit} style={{ marginTop: 'var(--space-3)' }}>
          {state.done && <Notice tone="success">Request sent. You’ll be notified when it’s handled.</Notice>}
          <ErrorBox error={state.error} />
          <Field label="Type of request">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Details" hint="Who it’s for, where to send it, or exactly what should change." required>
            <textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} required maxLength={3000} />
          </Field>
          <div><button type="submit" className="p-btn p-btn--primary" disabled={state.busy || !form.details.trim()}>Send request</button></div>
        </form>
      </div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length > 0 && (
        <div className="p-table-wrap">
          <table className="p-table">
            <thead><tr><th>Date</th><th>Request</th><th>Status</th><th>Response</th></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td>{date(r.created_at)}</td>
                  <td><strong>{humanize(r.type)}</strong><div className="p-list-item__meta">{r.details}</div></td>
                  <td><Badge status={r.status} /></td>
                  <td>{r.response ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function FeedbackTab() {
  const { data, error, loading, reload } = useApi('/student/feedback')
  const [form, setForm] = useState({ courseId: '', rating: 0, comments: '' })
  const [state, setState] = useState({})
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  async function submit(e) {
    e.preventDefault()
    setState({ busy: true })
    try {
      await api('/student/feedback', { method: 'POST', body: { courseId: form.courseId || null, rating: form.rating, comments: form.comments } })
      setForm({ courseId: '', rating: 0, comments: '' })
      setState({ done: true })
      reload()
    } catch (err) {
      setState({ error: err })
    }
  }

  return (
    <>
      <div className="card">
        <h2 className="portal-card-title">Course evaluation</h2>
        <form className="p-form" onSubmit={submit} style={{ marginTop: 'var(--space-3)' }}>
          {state.done && <Notice tone="success">Thank you — your feedback helps us improve.</Notice>}
          <ErrorBox error={state.error} />
          <Field label="Course">
            <select value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })}>
              <option value="">General / whole programme</option>
              {data.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <fieldset className="p-field" style={{ border: 0, padding: 0 }}>
            <legend className="p-field__label">Rating</legend>
            <div className="p-form__actions">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className={`p-btn${form.rating >= n ? ' p-btn--primary' : ''}`} aria-pressed={form.rating === n} onClick={() => setForm({ ...form, rating: n })}>
                  {n} ★
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Comments (optional)"><textarea value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} maxLength={3000} /></Field>
          <div><button type="submit" className="p-btn p-btn--primary" disabled={state.busy || !form.rating}>Send feedback</button></div>
        </form>
      </div>
      {data.given.length > 0 && (
        <div className="p-table-wrap">
          <table className="p-table">
            <thead><tr><th>Date</th><th>Course</th><th>Rating</th><th>Comments</th></tr></thead>
            <tbody>{data.given.map((f) => <tr key={f.id}><td>{date(f.created_at)}</td><td>{f.course_name ?? 'General'}</td><td>{'★'.repeat(f.rating)}</td><td>{f.comments ?? '—'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  )
}
