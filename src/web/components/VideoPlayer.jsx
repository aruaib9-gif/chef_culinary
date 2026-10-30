'use client'
// Plays a training video from a short-lived private link. Discourages copying: no download button or
// right-click menu, no picture-in-picture, and a moving watermark with the viewer's name and email that stays
// on screen in full screen too (we full-screen the wrapper, not the bare video). Expired links are replaced
// silently, and progress is reported every 30 s, which also keeps this device's one-at-a-time playback slot.
import { useCallback, useEffect, useRef, useState } from 'react'
import './VideoPlayer.css'

const HEARTBEAT_MS = 30_000

export default function VideoPlayer({ lessonId, title, watermark, getSource, report, release, startAt = 0, onEnded }) {
  const wrapRef = useRef(null)
  const videoRef = useRef(null)
  const lastBeat = useRef(0)
  const retried = useRef(0)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mark, setMark] = useState({ x: 8, y: 10 })
  const [full, setFull] = useState(false)

  const load = useCallback(async (resumeAt, autoplay) => {
    const video = videoRef.current
    if (!video) return
    setLoading(true)
    setError(null)
    try {
      const src = await getSource()
      video.src = src.url
      video.addEventListener('loadedmetadata', () => {
        if (resumeAt > 0 && resumeAt < video.duration - 5) video.currentTime = resumeAt
        if (autoplay) video.play().catch(() => {})
      }, { once: true })
    } catch (err) {
      setError(err.message ?? 'This video could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [getSource])

  // New lesson: fetch its link and resume where the viewer left off.
  useEffect(() => {
    retried.current = 0
    load(startAt, false)
    const video = videoRef.current
    return () => {
      if (video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
    }
  }, [lessonId]) // eslint-disable-line react-hooks/exhaustive-deps

  const beat = useCallback(async (playing) => {
    const video = videoRef.current
    if (!report || !video) return
    lastBeat.current = Date.now()
    try {
      await report({ position: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : undefined, playing })
    } catch (err) {
      if (err.status === 409) {
        video.pause()
        setError(err.message)
      }
    }
  }, [report])

  // Free the playback slot when the page goes away.
  useEffect(() => {
    if (!release) return
    const onHide = () => release()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      release()
    }
  }, [release])

  // The watermark wanders so it can't simply be cropped out.
  useEffect(() => {
    const t = setInterval(() => setMark({ x: 4 + Math.random() * 60, y: 6 + Math.random() * 78 }), 12_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onChange = () => {
      // Some browsers full-screen the bare <video> (double-click, their own button), which would hide the
      // watermark: swap to full-screening our wrapper instead.
      if (document.fullscreenElement && document.fullscreenElement === videoRef.current) {
        document.exitFullscreen?.().then(() => wrapRef.current?.requestFullscreen?.()).catch(() => {})
        return
      }
      setFull(document.fullscreenElement === wrapRef.current)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else wrapRef.current?.requestFullscreen?.().catch(() => {})
  }

  // An expired or rejected link: fetch a fresh one and carry on from the same spot (at most a few times).
  function onError() {
    const video = videoRef.current
    if (!video?.getAttribute('src') || retried.current >= 3) {
      if (retried.current >= 3) setError('The video stopped loading. Check your connection and reload the page.')
      return
    }
    retried.current += 1
    load(video.currentTime, !video.paused || video.currentTime > 0)
  }

  return (
    <div className={`vp${full ? ' is-full' : ''}`} ref={wrapRef} onContextMenu={(e) => e.preventDefault()}>
      <video
        ref={videoRef}
        className="vp__video"
        controls
        playsInline
        preload="metadata"
        controlsList="nodownload nofullscreen noremoteplayback"
        disablePictureInPicture
        disableRemotePlayback
        draggable={false}
        aria-label={title}
        onDoubleClick={(e) => { e.preventDefault(); toggleFullscreen() }}
        onPlay={() => { retried.current = 0; beat(true) }}
        onPause={() => beat(false)}
        onTimeUpdate={() => { if (Date.now() - lastBeat.current > HEARTBEAT_MS && !videoRef.current?.paused) beat(true) }}
        onEnded={() => { beat(false); onEnded?.() }}
        onError={onError}
      />
      {watermark && (
        <span className="vp__mark" style={{ left: `${mark.x}%`, top: `${mark.y}%` }} aria-hidden="true">{watermark}</span>
      )}
      <button type="button" className="vp__fs" onClick={toggleFullscreen} aria-label={full ? 'Exit full screen' : 'Full screen'}>
        {full ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        )}
      </button>
      {loading && <div className="vp__state"><span className="vp__spinner" aria-hidden="true" />Loading video…</div>}
      {error && <div className="vp__state vp__state--error" role="alert">{error}</div>}
    </div>
  )
}
