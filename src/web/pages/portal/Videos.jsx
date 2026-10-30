'use client'
import { useApi } from '../../lib/useApi.js'
import { PageHead, Loading, ErrorBox, Empty } from '../../components/portal/ui.jsx'
import VideoCourseCard from '../../components/VideoCourseCard.jsx'

// Online video courses: the ones this account can watch, then everything else on offer.
export default function Videos() {
  const { data, error, loading, reload } = useApi('/videos/courses')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  const mine = data.filter((c) => c.owned || !c.price_kobo)
  const more = data.filter((c) => !c.owned && c.price_kobo)

  return (
    <div className="portal-page">
      <PageHead title="Online courses" intro="Recorded training videos you can watch at your own pace, on this website." />
      {data.length === 0 && <Empty title="No online courses yet">New video courses will appear here as soon as they are published.</Empty>}
      {mine.length > 0 && (
        <section>
          <h2 className="portal-card-title">My courses</h2>
          <div className="vgrid">{mine.map((c) => <VideoCourseCard key={c.id} course={c} to={`/portal/videos/${c.slug}`} />)}</div>
        </section>
      )}
      {more.length > 0 && (
        <section>
          <h2 className="portal-card-title">{mine.length ? 'More courses' : 'Available courses'}</h2>
          <div className="vgrid">{more.map((c) => <VideoCourseCard key={c.id} course={c} to={`/portal/videos/${c.slug}`} />)}</div>
        </section>
      )}
    </div>
  )
}
