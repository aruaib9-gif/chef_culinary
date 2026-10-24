import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import { fetchFile } from '../../lib/api.js'
import { money } from '../../lib/format.js'
import { PageHead, Loading, ErrorBox, Empty, Notice } from '../../components/portal/ui.jsx'

// Result sheet: practical /70, theory /30, total /100, grade, remark (spec §8.3).
export default function Results() {
  const { data, error, loading, reload } = useApi('/student/results')
  const [downloading, setDownloading] = useState(null)
  const [dlError, setDlError] = useState(null)

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  if (data.withheld) {
    return (
      <div className="portal-page">
        <PageHead title="Results" />
        <Notice tone="warn">
          <span>Your results are withheld until your outstanding balance of <strong>{money(data.balanceKobo)}</strong> is cleared.</span>
          <Link className="portal-link-btn" to="/portal/payments">Pay now</Link>
        </Notice>
      </div>
    )
  }

  const terms = data.terms.filter((t) => t.rows.length)
  const scheme = data.scheme

  async function slip(cohortId) {
    setDownloading(cohortId)
    setDlError(null)
    try { await fetchFile(`/student/results/${cohortId}/slip.pdf`) } catch (e) { setDlError(e) } finally { setDownloading(null) }
  }

  return (
    <div className="portal-page">
      <PageHead title="Results" intro="Results appear here once published by the academy." />
      <ErrorBox error={dlError} />
      {terms.length === 0 ? (
        <Empty title="No published results yet">Your scores will appear here after your instructors’ assessments are published.</Empty>
      ) : (
        terms.map((t) => {
          const practicalMax = scheme?.components.find((c) => c.id === 'practical')?.max ?? 70
          const theoryMax = scheme?.components.find((c) => c.id === 'theory')?.max ?? 30
          return (
            <section key={t.cohortId} className="portal-page" style={{ gap: 'var(--space-3)' }}>
              <div className="portal-head--row">
                <div>
                  <h2 className="portal-card-title">{t.programme}</h2>
                  <p className="muted">{t.cohort}</p>
                </div>
                <button type="button" className="p-btn" onClick={() => slip(t.cohortId)} disabled={downloading === t.cohortId}>
                  {downloading === t.cohortId ? 'Preparing…' : 'Download result slip (PDF)'}
                </button>
              </div>
              <div className="p-table-wrap">
                <table className="p-table">
                  <thead>
                    <tr><th>Course</th><th className="num">Practical /{practicalMax}</th><th className="num">Theory /{theoryMax}</th><th className="num">Total /100</th><th>Grade</th><th>Remark</th></tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.course_name}</td>
                        <td className="num">{r.practical ?? '—'}</td>
                        <td className="num">{r.theory ?? '—'}</td>
                        <td className="num"><strong>{r.total}</strong></td>
                        <td><strong>{r.grade}</strong></td>
                        <td>{r.remark}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Average{t.summary.position ? ` · Position ${t.summary.position} of ${t.summary.classSize}` : ''}</td>
                      <td className="num">{t.summary.average ?? '—'}</td>
                      <td colSpan={2}>{t.summary.grade ?? ''}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )
        })
      )}
      {scheme && (
        <div className="card">
          <h2 className="portal-card-title">Grading scale</h2>
          <div className="p-form__actions" style={{ marginTop: 'var(--space-2)' }}>
            {scheme.bands.map((b) => <span key={b.grade} className="portal-badge portal-badge--info">{b.grade}: {b.min}–{b.max} · {b.remark}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}
