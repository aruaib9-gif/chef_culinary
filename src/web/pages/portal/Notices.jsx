'use client'
import { useApi } from '../../lib/useApi.js'
import { dateTime } from '../../lib/format.js'
import { PageHead, Loading, ErrorBox, Empty } from '../../components/portal/ui.jsx'

export default function Notices() {
  const { data, error, loading, reload } = useApi('/student/announcements')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <div className="portal-page">
      <PageHead title="Notices & messages" intro="Announcements from the academy. Important notices are also sent to your email." />
      {data.length === 0 ? <Empty title="No notices">You’re all caught up.</Empty> : (
        <div className="p-list">
          {data.map((n) => (
            <article key={n.id} className="card">
              <h2 className="portal-card-title">{n.is_pinned && '📌 '}{n.title}</h2>
              <div className="p-list-item__meta">{dateTime(n.created_at)}</div>
              <p style={{ marginTop: 'var(--space-3)', whiteSpace: 'pre-line' }}>{n.body}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
