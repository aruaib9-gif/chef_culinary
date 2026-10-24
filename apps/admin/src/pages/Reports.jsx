import { useApi } from '../lib/useApi.js'
import { fetchFile } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { humanize } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Stat } from '../components/ui.jsx'

// Management overview + exports (spec §9.6). Excel opens the CSV exports directly.
export default function Reports() {
  const { isSuper } = useAuth()
  const { data, error, loading, reload } = useApi('/admin/reports/overview')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const funnel = Object.fromEntries(data.funnel.map((f) => [f.status, f.n]))
  const exports = [
    ['Students', '/admin/students/export.csv', 'students.csv'],
    ['Leads', '/admin/leads/export.csv', 'leads.csv'],
    ...(isSuper ? [['Payments', '/admin/finance/payments/export.csv', 'payments.csv'], ['Debtors', '/admin/finance/debtors.csv', 'debtors.csv'], ['Audit log', '/admin/audit-log.csv', 'audit-log.csv']] : []),
  ]
  return (
    <>
      <PageHeader title="Reports" intro="Results, attendance and income reports with date filters are on the Results, Attendance and Payments pages." />
      <div className="kpis">
        <Stat label="Certificates issued" value={data.outcomes.certificates} />
        <Stat label="Average published score" value={data.outcomes.average_score ?? '—'} />
        {data.statuses.map((s) => <Stat key={s.status} label={`${humanize(s.status)} students`} value={s.n} />)}
      </div>
      <div className="a-grid2" style={{ marginTop: 'var(--space-5)' }}>
        <section>
          <h2 className="a-section-title">Enrolment by programme</h2>
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>Programme</th><th className="num">All</th><th className="num">Active</th><th className="num">Graduated</th></tr></thead>
              <tbody>{data.enrolment.map((e) => <tr key={e.programme}><td>{e.programme}</td><td className="num">{e.students}</td><td className="num">{e.active}</td><td className="num">{e.graduated}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
        <section>
          <h2 className="a-section-title">Admissions funnel</h2>
          <div className="a-table-wrap">
            <table className="a-table">
              <tbody>{['draft', 'received', 'under_review', 'admitted', 'enrolled', 'waitlisted', 'declined'].map((s) => <tr key={s}><td>{humanize(s)}</td><td className="num">{funnel[s] ?? 0}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
        <section>
          <h2 className="a-section-title">Leads by source</h2>
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>Source</th><th className="num">Leads</th><th className="num">Converted</th><th className="num">Rate</th></tr></thead>
              <tbody>{data.leadSources.map((l) => <tr key={l.source}><td>{humanize(l.source)}</td><td className="num">{l.n}</td><td className="num">{l.converted}</td><td className="num">{l.n ? Math.round((l.converted / l.n) * 100) : 0}%</td></tr>)}</tbody>
            </table>
          </div>
        </section>
        <section>
          <h2 className="a-section-title">Exports (CSV / Excel)</h2>
          <div className="a-row">{exports.map(([label, path, name]) => <button key={label} type="button" className="a-btn a-btn--ghost" onClick={() => fetchFile(path, { filename: name })}>{label}</button>)}</div>
        </section>
      </div>
    </>
  )
}
