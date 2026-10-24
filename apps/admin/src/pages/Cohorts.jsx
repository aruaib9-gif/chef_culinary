import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { useAuth, useLookups } from '../lib/auth.jsx'
import { money, date, DAYS } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Badge, Modal, Field, ProgrammeSelect, CourseSelect, CohortSelect, Tabs, useAction } from '../components/ui.jsx'

// Cohorts, their students and the weekly timetable (spec §9.3).
export default function Cohorts() {
  const [f, setF] = useState({ status: '', programmeId: '' })
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString()
  const { data, error, loading, reload } = useApi(`/admin/cohorts?${qs}`)
  const [editing, setEditing] = useState(null)
  return (
    <>
      <PageHeader title="Cohorts & timetable" intro="Create intakes (including sponsored cohorts), set schedules and build timetables." actions={<button type="button" className="a-btn" onClick={() => setEditing({})}>New cohort</button>} />
      <div className="a-filters">
        <ProgrammeSelect value={f.programmeId} onChange={(v) => setF({ ...f, programmeId: v })} />
        <select className="a-input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">All statuses</option>{['planned', 'active', 'completed', 'archived'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Cohort</th><th>Programme</th><th>Dates</th><th>Schedule</th><th className="num">Students</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.length === 0 && <tr><td colSpan={7} className="a-empty">No cohorts yet.</td></tr>}
              {data.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/cohorts/${c.id}`}>{c.name}</Link>{c.sponsor && <div className="a-meta">Sponsor: {c.sponsor}</div>}</td>
                  <td>{c.programme_name}</td>
                  <td className="nowrap">{date(c.starts_on)} – {date(c.ends_on)}</td>
                  <td>{c.schedule ?? '—'}</td>
                  <td className="num">{c.student_count}{c.capacity ? ` / ${c.capacity}` : ''}</td>
                  <td><Badge status={c.status} /></td>
                  <td><button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setEditing(c)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <CohortModal cohort={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function CohortModal({ cohort, onClose, onSaved }) {
  const { reloadLookups } = useLookups()
  const { isSuper } = useAuth()
  const [form, setForm] = useState({
    programmeId: cohort.programme_id ?? '', name: cohort.name ?? '', sponsor: cohort.sponsor ?? '', sponsorEmail: cohort.sponsor_email ?? '',
    startsOn: cohort.starts_on ?? '', endsOn: cohort.ends_on ?? '', schedule: cohort.schedule ?? 'Mon, Wed, Fri', status: cohort.status ?? 'active',
    capacity: cohort.capacity ?? '', fee: cohort.fee_kobo != null ? cohort.fee_kobo / 100 : '', rules: cohort.rules ?? '', notes: cohort.notes ?? '',
  })
  const action = useAction()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  async function save() {
    const body = { ...form, capacity: form.capacity || null, feeKobo: form.fee === '' ? null : Math.round(Number(form.fee) * 100) }
    const r = await action.run(() => (cohort.id ? api(`/admin/cohorts/${cohort.id}`, { method: 'PUT', body }) : api('/admin/cohorts', { method: 'POST', body })))
    if (r) { reloadLookups(); onSaved() }
  }
  async function remove() {
    if (!window.confirm('Delete this cohort? Only possible when it has no students or results.')) return
    if (await action.run(() => api(`/admin/cohorts/${cohort.id}`, { method: 'DELETE' }))) { reloadLookups(); onSaved() }
  }
  return (
    <Modal title={cohort.id ? `Edit ${cohort.name}` : 'New cohort'} onClose={onClose} wide>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <div className="a-form__row">
          <Field label="Programme" required error={action.errors.programmeId}><ProgrammeSelect value={form.programmeId} onChange={(v) => setForm({ ...form, programmeId: v })} allowEmpty="Select…" className="" /></Field>
          <Field label="Cohort name" required error={action.errors.name} hint="e.g. PC January 2027, SUPA ITF Batch 3"><input value={form.name} onChange={set('name')} /></Field>
          <Field label="Status"><select value={form.status} onChange={set('status')}>{['planned', 'active', 'completed', 'archived'].map((s) => <option key={s}>{s}</option>)}</select></Field>
        </div>
        <div className="a-form__row">
          <Field label="Start date"><input type="date" value={form.startsOn} onChange={set('startsOn')} /></Field>
          <Field label="End date" error={action.errors.endsOn}><input type="date" value={form.endsOn} onChange={set('endsOn')} /></Field>
          <Field label="Schedule"><input value={form.schedule} onChange={set('schedule')} placeholder="Mon, Wed, Fri · 9am–3pm" /></Field>
          <Field label="Capacity"><input type="number" min="1" value={form.capacity} onChange={set('capacity')} /></Field>
        </div>
        <div className="a-form__row">
          <Field label="Fee override (₦)" hint="Leave blank to use the programme fee."><input type="number" min="0" value={form.fee} onChange={set('fee')} /></Field>
          <Field label="Sponsor organisation" hint="Sponsored students get a matching sponsor credit."><input value={form.sponsor} onChange={set('sponsor')} placeholder="e.g. SUPA ITF" /></Field>
          <Field label="Sponsor email" error={action.errors.sponsorEmail}><input type="email" value={form.sponsorEmail} onChange={set('sponsorEmail')} /></Field>
        </div>
        <Field label="Cohort rules & policies" hint="Shown to sponsored cohorts (spec §5.2)."><textarea value={form.rules} onChange={set('rules')} /></Field>
        <Field label="Internal notes"><textarea value={form.notes} onChange={set('notes')} /></Field>
        <div className="a-form__foot">
          {cohort.id && isSuper && <button type="button" className="a-btn a-btn--danger" style={{ marginRight: 'auto' }} onClick={remove}>Delete</button>}
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy} onClick={save}>Save cohort</button>
        </div>
      </div>
    </Modal>
  )
}

export function CohortDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: c, error, loading, reload } = useApi(`/admin/cohorts/${id}`)
  const [tab, setTab] = useState('timetable')
  const [editing, setEditing] = useState(false)
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <>
      <PageHeader
        title={c.name}
        intro={<>{c.programme_name} · {date(c.starts_on)} – {date(c.ends_on)} · {c.schedule ?? 'No schedule'} · <Badge status={c.status} />{c.fee_kobo != null && ` · Fee ${money(c.fee_kobo)}`}</>}
        actions={<><button type="button" className="a-btn a-btn--ghost" onClick={() => navigate('/cohorts')}>Back</button><button type="button" className="a-btn a-btn--ghost" onClick={() => setEditing(true)}>Edit cohort</button></>}
      />
      <Tabs tabs={[['timetable', 'Timetable'], ['students', `Students (${c.students.length})`], ['rules', 'Rules']]} value={tab} onChange={setTab} />
      {tab === 'timetable' && <TimetableBuilder cohort={c} />}
      {tab === 'students' && <CohortStudents cohort={c} onChange={reload} />}
      {tab === 'rules' && <div className="panel" style={{ whiteSpace: 'pre-line' }}>{c.rules || <span className="muted">No rules recorded. Add them via Edit cohort.</span>}</div>}
      {editing && <CohortModal cohort={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload() }} />}
    </>
  )
}

function CohortStudents({ cohort, onChange }) {
  const [adding, setAdding] = useState(false)
  return (
    <>
      <div className="a-row" style={{ marginBottom: 'var(--space-3)' }}>
        <button type="button" className="a-btn a-btn--ghost" onClick={() => setAdding(true)}>Move students into this cohort</button>
        <Link className="a-btn a-btn--ghost" to={`/attendance?cohortId=${cohort.id}`}>Attendance</Link>
        <Link className="a-btn a-btn--ghost" to={`/results?cohortId=${cohort.id}`}>Results</Link>
      </div>
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Student ID</th><th>Name</th><th>Email</th><th>Phone</th><th>Status</th></tr></thead>
          <tbody>
            {cohort.students.length === 0 && <tr><td colSpan={5} className="a-empty">No students in this cohort yet.</td></tr>}
            {cohort.students.map((s) => <tr key={s.id}><td><Link to={`/students/${s.id}`}>{s.student_number}</Link></td><td>{s.first_name} {s.last_name}</td><td>{s.email ?? '—'}</td><td>{s.phone ?? '—'}</td><td><Badge status={s.status} /></td></tr>)}
          </tbody>
        </table>
      </div>
      {adding && <AssignModal cohort={cohort} onClose={() => setAdding(false)} onDone={() => { setAdding(false); onChange() }} />}
    </>
  )
}

function AssignModal({ cohort, onClose, onDone }) {
  const { data, loading } = useApi(`/admin/students?programmeId=${cohort.programme_id}&status=active&pageSize=200`)
  const [picked, setPicked] = useState(new Set())
  const action = useAction()
  const candidates = (data?.items ?? []).filter((s) => s.cohort_id !== cohort.id)
  return (
    <Modal title={`Move students into ${cohort.name}`} onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        {loading ? <Loading /> : candidates.length === 0 ? <p className="muted">No other active students on this programme.</p> : (
          <div className="a-stack" style={{ gap: 'var(--space-2)', maxHeight: 360, overflowY: 'auto' }}>
            {candidates.map((s) => (
              <label key={s.id} className="a-check">
                <input type="checkbox" checked={picked.has(s.id)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n })} />
                <span>{s.first_name} {s.last_name} · {s.student_number} <span className="a-meta">({s.cohort_name ?? 'no cohort'})</span></span>
              </label>
            ))}
          </div>
        )}
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={!picked.size || action.busy} onClick={async () => { if (await action.run(() => api(`/admin/cohorts/${cohort.id}/students`, { method: 'POST', body: { studentIds: [...picked] } }))) onDone() }}>Move {picked.size || ''}</button>
        </div>
      </div>
    </Modal>
  )
}

function TimetableBuilder({ cohort }) {
  const { data, error, loading, reload } = useApi(`/admin/timetable?cohortId=${cohort.id}`)
  const [editing, setEditing] = useState(null)
  const [copyFrom, setCopyFrom] = useState('')
  const action = useAction()
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const days = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ d, entries: data.filter((e) => e.day_of_week === d) }))

  return (
    <>
      <div className="a-row" style={{ marginBottom: 'var(--space-3)' }}>
        <button type="button" className="a-btn" onClick={() => setEditing({ day_of_week: 1, start_time: '09:00', end_time: '12:00' })}>Add class</button>
        <span className="a-meta">or copy from</span>
        <CohortSelect value={copyFrom} onChange={setCopyFrom} allowEmpty="another cohort…" />
        <button type="button" className="a-btn a-btn--ghost" disabled={!copyFrom} onClick={async () => {
          if (!window.confirm('Replace this cohort’s timetable with a copy?')) return
          if (await action.run(() => api('/admin/timetable/copy', { method: 'POST', body: { fromCohortId: copyFrom, toCohortId: cohort.id } }))) reload()
        }}>Copy</button>
        <button type="button" className="a-btn a-btn--ghost" onClick={() => window.print()}>Print</button>
      </div>
      <ErrorBox error={action.error} />
      <div className="kpis">
        {days.filter((x) => x.entries.length || x.d <= 5).map(({ d, entries }) => (
          <div key={d} className="panel">
            <div className="panel__label" style={{ fontWeight: 700 }}>{DAYS[d]}</div>
            {entries.length === 0 && <p className="a-meta" style={{ marginTop: 'var(--space-2)' }}>No classes</p>}
            {entries.map((e) => (
              <button key={e.id} type="button" className="a-link" style={{ display: 'block', textAlign: 'left', textDecoration: 'none', marginTop: 'var(--space-2)', color: 'var(--color-ink)' }} onClick={() => setEditing(e)}>
                <strong>{e.start_time}–{e.end_time}</strong> {e.course_name ?? e.title}
                <div className="a-meta">{[e.course_name && e.title, e.instructor, e.venue].filter(Boolean).join(' · ')}</div>
              </button>
            ))}
          </div>
        ))}
      </div>
      {editing && <EntryModal cohort={cohort} entry={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function EntryModal({ cohort, entry, onClose, onSaved }) {
  const [form, setForm] = useState({ dayOfWeek: entry.day_of_week, startTime: entry.start_time, endTime: entry.end_time, title: entry.title ?? '', courseId: entry.course_id ?? '', instructor: entry.instructor ?? '', venue: entry.venue ?? '' })
  const action = useAction()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const body = { ...form, cohortId: cohort.id }
  return (
    <Modal title={entry.id ? 'Edit class' : 'Add class'} onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <div className="a-form__row">
          <Field label="Day"><select value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}</select></Field>
          <Field label="Start" error={action.errors.startTime}><input type="time" value={form.startTime} onChange={set('startTime')} /></Field>
          <Field label="End" error={action.errors.endTime}><input type="time" value={form.endTime} onChange={set('endTime')} /></Field>
        </div>
        <Field label="Course"><CourseSelect value={form.courseId} onChange={(v) => setForm({ ...form, courseId: v })} programmeId={cohort.programme_id} allowEmpty="— none —" className="" /></Field>
        <Field label="Title" required error={action.errors.title} hint="e.g. Practical kitchen, Theory, Assessment"><input value={form.title} onChange={set('title')} /></Field>
        <div className="a-form__row">
          <Field label="Instructor"><input value={form.instructor} onChange={set('instructor')} /></Field>
          <Field label="Venue"><input value={form.venue} onChange={set('venue')} /></Field>
        </div>
        <div className="a-form__foot">
          {entry.id && <button type="button" className="a-btn a-btn--danger" style={{ marginRight: 'auto' }} onClick={async () => { if (await action.run(() => api(`/admin/timetable/${entry.id}`, { method: 'DELETE' }))) onSaved() }}>Remove</button>}
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy} onClick={async () => { if (await action.run(() => (entry.id ? api(`/admin/timetable/${entry.id}`, { method: 'PUT', body }) : api('/admin/timetable', { method: 'POST', body })))) onSaved() }}>Save</button>
        </div>
      </div>
    </Modal>
  )
}

