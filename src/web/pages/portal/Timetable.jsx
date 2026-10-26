'use client'
import { useApi } from '../../lib/useApi.js'
import { date, DAYS } from '../../lib/format.js'
import { PageHead, Loading, ErrorBox, Empty } from '../../components/portal/ui.jsx'

export default function Timetable() {
  const { data, error, loading, reload } = useApi('/student/timetable')
  const att = useApi('/student/attendance')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const days = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ d, entries: data.entries.filter((e) => e.day_of_week === d) })).filter((x) => x.entries.length)

  return (
    <div className="portal-page">
      <PageHead
        title="Timetable"
        intro={[data.cohort, data.schedule, data.startsOn && `${date(data.startsOn)} – ${date(data.endsOn)}`].filter(Boolean).join(' · ') || 'Your weekly class schedule.'}
        actions={days.length > 0 && <button type="button" className="p-btn" onClick={() => window.print()}>Print</button>}
      />
      {days.length === 0 ? (
        <Empty title="Timetable not published yet">Your class times will appear here once the academy publishes your cohort’s timetable.</Empty>
      ) : (
        <div className="portal-timetable">
          {days.map(({ d, entries }) => (
            <div key={d} className="card portal-day">
              <div className="portal-day__name">{DAYS[d]}</div>
              <ul className="portal-day__sessions">
                {entries.map((e) => (
                  <li key={e.id}>
                    <strong>{e.start_time}–{e.end_time}</strong> · {e.course_name ?? e.title}
                    {(e.instructor || e.venue) && <div className="p-list-item__meta">{[e.course_name && e.title, e.instructor, e.venue].filter(Boolean).join(' · ')}</div>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {att.data?.records?.length > 0 && (
        <section className="portal-page" style={{ gap: 'var(--space-3)' }}>
          <h2 className="portal-card-title">My attendance · {att.data.summary?.rate ?? '—'}%</h2>
          <div className="p-table-wrap">
            <table className="p-table">
              <thead><tr><th>Date</th><th>Status</th></tr></thead>
              <tbody>
                {att.data.records.slice(0, 30).map((r) => (
                  <tr key={r.date}><td>{date(r.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</td><td style={{ textTransform: 'capitalize' }}>{r.status}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
