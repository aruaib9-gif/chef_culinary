'use client'
import { useEffect, useState } from 'react'
import { Link } from '@/lib/router'
import PageHeader from '../components/ui/PageHeader.jsx'
import VideoCourseCard from '../components/VideoCourseCard.jsx'
import { api } from '../lib/api.js'

// Public catalogue of online video courses. Buying and watching happen in the portal (sign-in required).
export default function OnlineCourses() {
  const [courses, setCourses] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    api('/videos/courses').then((rows) => alive && setCourses(rows)).catch(() => alive && setFailed(true))
    return () => { alive = false }
  }, [])

  return (
    <>
      <PageHeader
        eyebrow="Learn online"
        title="Online courses"
        intro="Recorded lessons from our chefs. Pay once, then watch at your own pace on your phone, tablet or computer."
      />
      <section className="section">
        <div className="container" style={{ display: 'grid', gap: 'var(--space-6)' }}>
          {failed && <p className="muted">The courses could not be loaded right now. Please try again shortly.</p>}
          {courses && courses.length === 0 && <p className="muted">Our first online courses are coming soon. <Link to="/contact">Contact us</Link> to hear when they launch.</p>}
          {!courses && !failed && <p className="muted">Loading courses…</p>}
          {courses?.length > 0 && (
            <div className="vgrid">
              {courses.map((c) => <VideoCourseCard key={c.id} course={c} to={`/portal/videos/${c.slug}`} />)}
            </div>
          )}
          <div className="vhow">
            <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>How it works</h2>
            <ol style={{ margin: 0, paddingLeft: '1.2em', display: 'grid', gap: 'var(--space-1)' }}>
              <li>Choose a course and <Link to="/portal/signup?next=/portal/videos">create a free account</Link> (or sign in).</li>
              <li>Watch the free preview lessons, then pay securely online with card, bank transfer or USSD.</li>
              <li>The whole course unlocks straight away. Videos play on this website and can't be downloaded.</li>
            </ol>
          </div>
        </div>
      </section>
    </>
  )
}
