'use client'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from '@/lib/router'
import { useApi } from '../../lib/useApi.js'
import { api, releaseVideoSlot } from '../../lib/api.js'
import { useAuth } from '../../lib/auth.jsx'
import { date } from '../../lib/format.js'
import { Loading, ErrorBox, Notice } from '../../components/portal/ui.jsx'
import VideoPlayer from '../../components/VideoPlayer.jsx'
import { runningTime, priceLabel } from '../../components/VideoCourseCard.jsx'
import './VideoCourse.css'

const clock = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '')

export default function VideoCourse() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  const { data, error, loading, reload, setData } = useApi(`/videos/courses/${slug}`)
  const [current, setCurrent] = useState(null)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState(null)
  const [paid, setPaid] = useState(null) // result of returning from Paystack

  // Back from Paystack: confirm the payment, then show the unlocked course.
  const reference = params.get('reference')
  useEffect(() => {
    if (!reference) return
    let alive = true
    api(`/videos/orders/verify/${encodeURIComponent(reference)}`)
      .then((r) => { if (alive) { setPaid(r); reload() } })
      .catch((err) => alive && setPayError(err))
      .finally(() => alive && setParams({}, { replace: true }))
    return () => { alive = false }
  }, [reference]) // eslint-disable-line react-hooks/exhaustive-deps

  // Start on the first unfinished lesson the viewer can play.
  useEffect(() => {
    if (!data || current) return
    const playable = data.lessons.filter((l) => l.playable && l.ready)
    setCurrent((playable.find((l) => !l.completed) ?? playable[0])?.id ?? null)
  }, [data, current])

  const getSource = useCallback(() => api(`/videos/lessons/${current}/play`, { method: 'POST' }), [current])
  const report = useCallback(async (body) => {
    const r = await api(`/videos/lessons/${current}/progress`, { method: 'POST', body })
    setData((d) => d && {
      ...d,
      lessons: d.lessons.map((l) => (l.id === current ? { ...l, position_seconds: body.position, completed: l.completed || r.completed, duration_seconds: l.duration_seconds ?? (body.duration ? Math.round(body.duration) : null) } : l)),
    })
  }, [current, setData])

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  const lesson = data.lessons.find((l) => l.id === current)
  const lessonIndex = data.lessons.findIndex((l) => l.id === current)
  const done = data.lessons.filter((l) => l.completed).length
  const full = data.access === 'full'
  const totalSeconds = data.lessons.reduce((n, l) => n + (l.duration_seconds ?? 0), 0)

  function playNext() {
    const next = data.lessons.slice(lessonIndex + 1).find((l) => l.playable && l.ready)
    if (next) setCurrent(next.id)
  }

  async function buy() {
    setPaying(true)
    setPayError(null)
    try {
      const { authorizationUrl } = await api(`/videos/courses/${data.id}/checkout`, { method: 'POST' })
      window.location.assign(authorizationUrl)
    } catch (err) {
      setPayError(err)
      setPaying(false)
    }
  }

  return (
    <div className="portal-page vcourse">
      <div>
        <Link to="/portal/videos" className="vcourse__back">← All online courses</Link>
        <h1 className="vcourse__title">{data.title}</h1>
        {data.summary && <p className="muted">{data.summary}</p>}
      </div>

      {paid?.status === 'success' && <Notice tone="success">Payment received — the whole course is now unlocked. Enjoy!</Notice>}
      {paid && paid.status !== 'success' && <Notice tone="warn">The payment was not completed. You have not been charged; you can try again below.</Notice>}
      <ErrorBox error={payError} />

      <div className="vcourse__layout">
        <div className="vcourse__main">
          {lesson ? (
            <>
              <VideoPlayer
                key={lesson.id}
                lessonId={lesson.id}
                title={lesson.title}
                watermark={[user?.fullName, user?.email].filter(Boolean).join(' · ')}
                getSource={getSource}
                report={report}
                release={releaseVideoSlot}
                startAt={lesson.completed ? 0 : lesson.position_seconds}
                onEnded={playNext}
              />
              <div className="vcourse__now">
                <h2>{lessonIndex + 1}. {lesson.title}</h2>
                {lesson.description && <p className="vcourse__desc">{lesson.description}</p>}
              </div>
            </>
          ) : (
            <div className="vcourse__locked card">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
              <p>{data.lessons.length ? 'Buy the course to start watching.' : 'Lessons are being added. Check back soon.'}</p>
            </div>
          )}

        </div>

        <aside className="vcourse__side">
          <div className="card vcourse__buy">
            {full ? (
              <>
                <div className="vcourse__progress-label">
                  <strong>{done} of {data.lessons.length}</strong> lessons completed
                </div>
                <div className="vcourse__bar" aria-hidden="true"><span style={{ width: `${data.lessons.length ? (done / data.lessons.length) * 100 : 0}%` }} /></div>
                {data.expires_at && <p className="p-list-item__meta">Access until {date(data.expires_at)}</p>}
              </>
            ) : (
              <>
                <div className="vcourse__price">{priceLabel(data.price_kobo)}</div>
                <p className="p-list-item__meta">
                  {data.lessons.length} lessons{totalSeconds ? ` · ${runningTime(totalSeconds)}` : ''} · {data.access_days ? `${data.access_days} days' access` : 'lifetime access'}
                </p>
                {data.online_payments ? (
                  <button type="button" className="p-btn p-btn--primary vcourse__cta" onClick={buy} disabled={paying}>
                    {paying ? 'Opening secure checkout…' : `Buy course · ${priceLabel(data.price_kobo)}`}
                  </button>
                ) : (
                  <Notice tone="info">Online payment is coming soon. To buy now, pay at the academy or by bank transfer and we'll unlock the course for this account ({user?.email}).</Notice>
                )}
                <p className="p-list-item__meta">Videos stream on this website only and can't be downloaded. One device at a time.</p>
              </>
            )}
          </div>

          <ol className="vcourse__lessons">
            {data.lessons.map((l, i) => {
              const canPlay = l.playable && l.ready
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    className={`vlesson${l.id === current ? ' is-current' : ''}${l.completed ? ' is-done' : ''}`}
                    onClick={() => canPlay && setCurrent(l.id)}
                    disabled={!canPlay}
                    aria-current={l.id === current ? 'true' : undefined}
                  >
                    <span className="vlesson__icon" aria-hidden="true">
                      {l.completed ? '✓' : !l.playable ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
                      ) : i + 1}
                    </span>
                    <span className="vlesson__text">
                      <span className="vlesson__title">{l.title}</span>
                      <span className="vlesson__meta">
                        {clock(l.duration_seconds)}
                        {l.is_preview && !full && <span className="vlesson__tag">Free preview</span>}
                        {!l.ready && <span className="vlesson__tag vlesson__tag--muted">Coming soon</span>}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </aside>

        {data.description && (
          <section className="card vcourse__about">
            <h2 className="portal-card-title">About this course</h2>
            <p className="vcourse__desc">{data.description}</p>
          </section>
        )}
      </div>
    </div>
  )
}
