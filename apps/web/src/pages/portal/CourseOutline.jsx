import { useState } from 'react'
import { useApi } from '../../lib/useApi.js'
import { fetchFile } from '../../lib/api.js'
import { fileSize } from '../../lib/format.js'
import { PageHead, Loading, ErrorBox, Empty } from '../../components/portal/ui.jsx'

// Programme and course outlines uploaded by the academy.
export default function CourseOutline() {
  const { data, error, loading, reload } = useApi('/student/course-outline')
  const [dlError, setDlError] = useState(null)
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { programme, courses } = data
  if (!programme) return <Empty title="No programme yet">Your course outline appears here once you’re enrolled on a programme.</Empty>

  const download = (path) => fetchFile(path).catch(setDlError)

  return (
    <div className="portal-page">
      <PageHead
        title="Course outline"
        intro={[programme.name, programme.duration_weeks && `${programme.duration_weeks} weeks`, programme.schedule].filter(Boolean).join(' · ')}
        actions={programme.outline && (
          <button type="button" className="p-btn p-btn--primary" onClick={() => download('/student/course-outline/programme/download')}>
            Download programme outline
          </button>
        )}
      />
      <ErrorBox error={dlError} />
      {programme.outline && <p className="p-list-item__meta">{programme.outline.filename} · {fileSize(programme.outline.size)}</p>}
      {programme.curriculum && (
        <div className="card">
          <h2 className="portal-card-title">Curriculum overview</h2>
          <p style={{ marginTop: 'var(--space-2)', whiteSpace: 'pre-line' }}>{programme.curriculum}</p>
        </div>
      )}
      <section className="portal-page" style={{ gap: 'var(--space-3)' }}>
        <h2 className="portal-card-title">Courses ({courses.length})</h2>
        {courses.length === 0 ? <p className="muted">No courses have been linked to your programme yet.</p> : (
          <ul className="p-list">
            {courses.map((c) => (
              <li key={c.id} className="p-list-item">
                <div>
                  <div className="p-list-item__title">{c.name}</div>
                  <div className="p-list-item__meta">{c.type}{c.outline ? ` · ${c.outline.filename} · ${fileSize(c.outline.size)}` : ' · Outline not uploaded yet'}</div>
                  {c.description && <p className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>{c.description}</p>}
                </div>
                {c.outline && <button type="button" className="p-btn" onClick={() => download(`/student/course-outline/courses/${c.id}/download`)}>Download outline</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
