'use client'
import { Link } from '@/lib/router'
import { money } from '../lib/format.js'
import './VideoCourseCard.css'

/** "1 h 25 min" / "12 min" from seconds. */
export function runningTime(seconds) {
  if (!seconds) return ''
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.max(1, m)} min`
}

export const priceLabel = (kobo) => (kobo ? money(kobo) : 'Free')

export default function VideoCourseCard({ course, to }) {
  return (
    <Link to={to} className="vcard">
      <div className="vcard__media">
        {course.cover_url
          ? <img src={course.cover_url} alt="" loading="lazy" />
          : <span className="vcard__placeholder" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></svg></span>}
        {course.owned && <span className="vcard__owned">Purchased</span>}
      </div>
      <div className="vcard__body">
        <h3 className="vcard__title">{course.title}</h3>
        {course.summary && <p className="vcard__summary">{course.summary}</p>}
        <div className="vcard__meta">
          <span>{course.lessons} lesson{course.lessons === 1 ? '' : 's'}{course.seconds ? ` · ${runningTime(course.seconds)}` : ''}</span>
          <strong>{course.owned ? 'Watch now' : priceLabel(course.price_kobo)}</strong>
        </div>
      </div>
    </Link>
  )
}
