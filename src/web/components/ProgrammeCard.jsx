'use client'
import { programmeTypes } from '@cca/shared/programmes'
import { formatFee, feeBreakdown } from '@cca/shared/format'
import Button from './ui/Button.jsx'
import './ProgrammeCard.css'

const icons = {
  duration: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  schedule: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>,
  fee: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12l-8.5 8.5a2 2 0 01-2.8 0L3 15V5a2 2 0 012-2h7l8 8a2 2 0 010 1z" /><circle cx="8" cy="8" r="1.4" /></svg>,
}

export default function ProgrammeCard({ programme }) {
  const fees = feeBreakdown(programme.fee)
  return (
    <article className="programme-card">
      <div className="programme-card__head">
        <span className="programme-card__type">{programmeTypes[programme.type]}</span>
        <h3 className="programme-card__title">{programme.name}</h3>
        <p className="muted programme-card__summary">{programme.summary}</p>
      </div>

      <ul className="programme-card__meta">
        <li><span className="programme-card__ico" aria-hidden="true">{icons.duration}</span>{programme.durationWeeks} {programme.durationWeeks === 1 ? 'week' : 'weeks'}</li>
        <li><span className="programme-card__ico" aria-hidden="true">{icons.schedule}</span>{programme.schedule}</li>
        {!fees && <li><span className="programme-card__ico" aria-hidden="true">{icons.fee}</span>Contact us for the fee</li>}
      </ul>

      {fees && (
        <dl className="programme-card__fees">
          <div><dt>Tuition</dt><dd>{formatFee(fees.tuition)}</dd></div>
          <div><dt>Registration fee</dt><dd>{formatFee(fees.registration)}</dd></div>
          <div><dt>VAT (7.5%)</dt><dd>{formatFee(fees.vat)}</dd></div>
          <div className="programme-card__total"><dt>Total</dt><dd>{formatFee(fees.total)}</dd></div>
        </dl>
      )}

      <Button to={`/programmes/${programme.slug}`} variant="outline" block className="programme-card__btn">
        View programme
      </Button>
    </article>
  )
}
