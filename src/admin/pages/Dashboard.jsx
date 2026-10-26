'use client'
import { Link } from '@/lib/router'
import { useApi } from '../lib/useApi.js'
import { useAuth, useLookups } from '../lib/auth.jsx'
import { money, date } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Stat, Badge, Notice } from '../components/ui.jsx'

// Home dashboard (spec §9.6).
export default function Dashboard() {
  const { data, error, loading, reload } = useApi('/admin/dashboard')
  const { isSuper } = useAuth()
  const { integrations } = useLookups()
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { counts, finance, monthly, recentLeads, recentApps, lowAttendance, openRequests } = data
  const maxMonth = Math.max(1, ...monthly.map((m) => Number(m.total)))

  return (
    <>
      <PageHeader title="Dashboard" intro={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />
      {isSuper && integrations && (!integrations.email || !integrations.paystack) && (
        <Notice tone="warn">
          {!integrations.email && 'Email (SMTP) is not configured — emails are being logged, not sent. '}
          {!integrations.paystack && 'Paystack is not configured — students cannot pay online yet.'}
        </Notice>
      )}
      <div className="kpis">
        <Stat label="Active students" value={counts.active_students} sub={`${counts.total_students} on record`} />
        <Stat label="Active cohorts" value={counts.active_cohorts} />
        {finance && <Stat label="Income this month" value={money(finance.income_this_month)} sub={`Today ${money(finance.income_today)}`} />}
        {finance && <Stat label="Fees outstanding" value={money(Math.max(0, finance.outstanding))} tone={finance.outstanding > 0 ? 'warn' : undefined} />}
        <Stat label="New leads" value={counts.new_leads} sub={`${counts.leads_this_week} this week`} tone={counts.new_leads ? 'warn' : undefined} />
        <Stat label="Applications pending" value={counts.applications_pending} tone={counts.applications_pending ? 'warn' : undefined} />
        <Stat label="Draft results" value={counts.draft_results} sub="Awaiting publication" />
        <Stat label="Open student requests" value={openRequests} />
      </div>

      <div className="a-grid2" style={{ marginTop: 'var(--space-5)' }}>
        <section className="panel">
          <div className="a-row" style={{ justifyContent: 'space-between' }}><h2 className="a-section-title" style={{ margin: 0 }}>Recent applications</h2><Link to="/applications">All →</Link></div>
          <table className="a-table" style={{ marginTop: 'var(--space-3)' }}>
            <tbody>
              {recentApps.length === 0 && <tr><td className="a-empty">No applications yet</td></tr>}
              {recentApps.map((a) => (
                <tr key={a.id}>
                  <td><Link to={`/applications/${a.id}`}>{a.full_name || a.reference}</Link><div className="a-meta">{a.programme_name}</div></td>
                  <td className="nowrap">{date(a.submitted_at)}</td>
                  <td><Badge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <div className="a-row" style={{ justifyContent: 'space-between' }}><h2 className="a-section-title" style={{ margin: 0 }}>Latest leads</h2><Link to="/leads">All →</Link></div>
          <table className="a-table" style={{ marginTop: 'var(--space-3)' }}>
            <tbody>
              {recentLeads.length === 0 && <tr><td className="a-empty">No leads yet</td></tr>}
              {recentLeads.map((l) => (
                <tr key={l.id}><td>{l.name}<div className="a-meta">{l.programme_interest ?? '—'}</div></td><td>{l.source}</td><td className="nowrap">{date(l.created_at)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        {isSuper && (
          <section className="panel">
            <h2 className="a-section-title" style={{ marginTop: 0 }}>Income — last 6 months</h2>
            {monthly.length === 0 ? <p className="muted">No payments yet.</p> : (
              <div className="a-bars">
                {monthly.map((m) => (
                  <div key={m.month} className="a-bar">
                    <span>{m.month}</span>
                    <div className="a-bar__track"><div className="a-bar__fill" style={{ width: `${(Number(m.total) / maxMonth) * 100}%` }} /></div>
                    <span className="num" style={{ textAlign: 'right' }}>{money(m.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        <section className="panel">
          <div className="a-row" style={{ justifyContent: 'space-between' }}><h2 className="a-section-title" style={{ margin: 0 }}>Low attendance</h2><Link to="/attendance">Attendance →</Link></div>
          {lowAttendance.length === 0 ? <p className="muted" style={{ marginTop: 'var(--space-3)' }}>No students below 75%.</p> : (
            <table className="a-table" style={{ marginTop: 'var(--space-3)' }}>
              <tbody>
                {lowAttendance.map((s) => (
                  <tr key={s.id}><td><Link to={`/students/${s.id}`}>{s.first_name} {s.last_name}</Link><div className="a-meta">{s.student_number} · {s.cohort_name}</div></td><td className="num"><Badge status="absent">{s.rate}%</Badge></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  )
}
