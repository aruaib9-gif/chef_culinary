import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '../lib/useApi.js'
import { api, fetchFile } from '../lib/api.js'
import { date } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Badge, CohortSelect, Notice, Tabs, useAction } from '../components/ui.jsx'

const STATUSES = ['present', 'late', 'absent', 'excused']
const today = () => new Date().toISOString().slice(0, 10)

// Daily attendance sheets (printable), reports and low-attendance alerts (spec §9.3).
export default function Attendance() {
  const [params, setParams] = useSearchParams()
  const cohortId = params.get('cohortId') ? Number(params.get('cohortId')) : ''
  const [tab, setTab] = useState('sheet')
  return (
    <>
      <PageHeader title="Attendance" />
      <div className="a-filters">
        <CohortSelect value={cohortId} onChange={(v) => setParams(v ? { cohortId: v } : {}, { replace: true })} allowEmpty="Select cohort…" />
      </div>
      <Tabs tabs={[['sheet', 'Daily sheet'], ['report', 'Report']]} value={tab} onChange={setTab} />
      {!cohortId ? <Notice>Choose a cohort.</Notice> : tab === 'sheet' ? <Sheet cohortId={cohortId} /> : <Report cohortId={cohortId} />}
    </>
  )
}

function Sheet({ cohortId }) {
  const [day, setDay] = useState(today())
  const { data, error, loading, reload } = useApi(`/admin/attendance/sheet?cohortId=${cohortId}&date=${day}`)
  const dates = useApi(`/admin/attendance/dates?cohortId=${cohortId}`)
  const [marks, setMarks] = useState({})
  const action = useAction()

  useEffect(() => {
    if (data) setMarks(Object.fromEntries(data.rows.map((r) => [r.student_id, r.status ?? ''])))
  }, [data])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const unmarked = data.rows.filter((r) => !marks[r.student_id]).length

  async function save() {
    const records = Object.entries(marks).filter(([, s]) => s).map(([studentId, status]) => ({ studentId: Number(studentId), status }))
    if (await action.run(() => api('/admin/attendance/sheet', { method: 'PUT', body: { cohortId, date: day, records } }), 'saved')) { reload(); dates.reload() }
  }

  return (
    <>
      <div className="a-filters">
        <input className="a-input" type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} aria-label="Date" />
        <button type="button" className="a-btn a-btn--ghost" onClick={() => setMarks(Object.fromEntries(data.rows.map((r) => [r.student_id, marks[r.student_id] || 'present'])))}>Mark rest present</button>
        <button type="button" className="a-btn a-btn--ghost" onClick={() => window.print()}>Print sheet</button>
        <button type="button" className="a-btn" disabled={action.busy || !Object.values(marks).some(Boolean)} onClick={save}>Save attendance</button>
        {unmarked > 0 && <span className="a-meta">{unmarked} not marked</span>}
      </div>
      {action.ok && <Notice tone="success">Attendance saved for {date(day)}.</Notice>}
      <ErrorBox error={action.error} />
      <h2 className="a-section-title">{data.cohort.name} · {date(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>#</th><th>Student</th><th>Status</th><th className="print-only">Signature</th></tr></thead>
          <tbody>
            {data.rows.length === 0 && <tr><td colSpan={4} className="a-empty">No active students in this cohort.</td></tr>}
            {data.rows.map((r, i) => (
              <tr key={r.student_id}>
                <td>{i + 1}</td>
                <td>{r.last_name}, {r.first_name}<div className="a-meta">{r.student_number}</div></td>
                <td>
                  <div className="a-row" role="radiogroup" aria-label={`${r.first_name} ${r.last_name}`}>
                    {STATUSES.map((s) => (
                      <label key={s} className="a-check" style={{ textTransform: 'capitalize' }}>
                        <input type="radio" name={`att-${r.student_id}`} checked={marks[r.student_id] === s} onChange={() => setMarks((m) => ({ ...m, [r.student_id]: s }))} />{s}
                      </label>
                    ))}
                  </div>
                </td>
                <td className="print-only" style={{ minWidth: 140 }} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dates.data?.length > 0 && (
        <p className="a-meta" style={{ marginTop: 'var(--space-3)' }}>
          Recently marked: {dates.data.slice(0, 12).map((d) => (
            <button key={d.date} type="button" className="a-link" style={{ marginRight: 8 }} onClick={() => setDay(d.date)}>{date(d.date, { day: 'numeric', month: 'short' })} ({d.attended}/{d.marked})</button>
          ))}
        </p>
      )}
    </>
  )
}

function Report({ cohortId }) {
  const [range, setRange] = useState({ from: '', to: '' })
  const qs = new URLSearchParams({ cohortId, ...Object.fromEntries(Object.entries(range).filter(([, v]) => v)) }).toString()
  const { data, error, loading, reload } = useApi(`/admin/attendance/report?${qs}`)
  const action = useAction()
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const low = data.rows.filter((r) => r.low).length
  return (
    <>
      <div className="a-filters">
        <label className="a-meta">From <input className="a-input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label className="a-meta">To <input className="a-input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
        <button type="button" className="a-btn a-btn--ghost" onClick={() => fetchFile(`/admin/attendance/report.csv?${qs}`)}>Export CSV</button>
        <button type="button" className="a-btn" disabled={!low || action.busy} onClick={async () => { if (window.confirm(`Email ${low} student(s) below ${data.threshold}%?`)) await action.run(() => api('/admin/attendance/alerts', { method: 'POST', body: { cohortId } }), 'sent') }}>Send low-attendance alerts ({low})</button>
      </div>
      {action.ok && <Notice tone="success">Alerts sent.</Notice>}
      <ErrorBox error={action.error} />
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Student</th><th className="num">Sessions</th><th className="num">Present</th><th className="num">Late</th><th className="num">Absent</th><th className="num">Excused</th><th className="num">Rate</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.student_id}>
                <td>{r.last_name}, {r.first_name}<div className="a-meta">{r.student_number}</div></td>
                <td className="num">{r.sessions}</td><td className="num">{r.present}</td><td className="num">{r.late}</td><td className="num">{r.absent}</td><td className="num">{r.excused}</td>
                <td className="num">{r.rate == null ? '—' : <Badge status={r.low ? 'absent' : 'present'}>{r.rate}%</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="a-meta" style={{ marginTop: 'var(--space-2)' }}>Low-attendance threshold: {data.threshold}% (change in Settings). Excused absences are not counted against students.</p>
    </>
  )
}
