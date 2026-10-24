import { useState } from 'react'
import { useApi } from '../../lib/useApi.js'
import { fetchFile } from '../../lib/api.js'
import { date, fileSize } from '../../lib/format.js'
import { PageHead, Loading, ErrorBox, Empty } from '../../components/portal/ui.jsx'

export default function Materials() {
  const { data, error, loading, reload } = useApi('/student/materials')
  const [dlError, setDlError] = useState(null)
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  const groups = data.reduce((acc, m) => {
    const key = m.course_name ?? 'General'
    ;(acc[key] ??= []).push(m)
    return acc
  }, {})

  return (
    <div className="portal-page">
      <PageHead title="Learning materials" intro="Handbooks, workbooks, recipes and resources for your courses." />
      <ErrorBox error={dlError} />
      {data.length === 0 ? (
        <Empty title="Nothing published yet">Materials appear here as your instructors publish them.</Empty>
      ) : (
        Object.entries(groups).map(([course, items]) => (
          <section key={course} className="portal-page" style={{ gap: 'var(--space-3)' }}>
            <h2 className="portal-card-title">{course}</h2>
            <ul className="p-list">
              {items.map((m) => (
                <li key={m.id} className="p-list-item">
                  <div>
                    <div className="p-list-item__title">{m.title}</div>
                    {m.description && <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>{m.description}</p>}
                    <div className="p-list-item__meta">Added {date(m.created_at)}{m.filename ? ` · ${m.filename} · ${fileSize(m.size_bytes)}` : ''}</div>
                  </div>
                  <div className="p-form__actions">
                    {m.filename && <button type="button" className="p-btn" onClick={() => fetchFile(`/student/materials/${m.id}/download`).catch(setDlError)}>Download</button>}
                    {m.url && <a className="p-btn" href={m.url} target="_blank" rel="noopener noreferrer">Open link</a>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
