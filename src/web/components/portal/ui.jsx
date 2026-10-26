'use client'
// Small building blocks shared by the portal and auth pages.
import './portal-ui.css'

export function PageHead({ title, intro, actions }) {
  return (
    <div className="portal-head portal-head--row">
      <div>
        <h1>{title}</h1>
        {intro && <p className="muted">{intro}</p>}
      </div>
      {actions && <div className="portal-head__actions">{actions}</div>}
    </div>
  )
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="p-loading" role="status">
      <span className="p-spinner" aria-hidden="true" />
      {label}
    </div>
  )
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="p-alert p-alert--error" role="alert">
      <span>{error.message ?? String(error)}</span>
      {onRetry && <button type="button" className="p-link-btn" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function Notice({ tone = 'info', children }) {
  return <div className={`p-alert p-alert--${tone}`} role="status">{children}</div>
}

export function Empty({ title, children, action }) {
  return (
    <div className="card portal-empty">
      <h2 className="portal-card-title">{title}</h2>
      {children && <p className="muted">{children}</p>}
      {action && <div style={{ marginTop: 'var(--space-4)' }}>{action}</div>}
    </div>
  )
}

const TONES = {
  success: 'ok', paid: 'ok', published: 'ok', completed: 'ok', admitted: 'ok', enrolled: 'ok', present: 'ok', valid: 'ok', active: 'ok',
  pending: 'warn', part_paid: 'warn', in_progress: 'warn', under_review: 'warn', waitlisted: 'warn', late: 'warn', due: 'warn', open: 'warn',
  failed: 'bad', overdue: 'bad', declined: 'bad', rejected: 'bad', absent: 'bad', revoked: 'bad', refunded: 'muted', cancelled: 'muted', excused: 'muted',
}

export function Badge({ status, children }) {
  return <span className={`portal-badge portal-badge--${TONES[status] ?? 'info'}`}>{children ?? status?.replace(/_/g, ' ')}</span>
}

export function Field({ label, error, hint, required, children }) {
  return (
    <label className={`p-field${error ? ' has-error' : ''}`}>
      <span className="p-field__label">{label}{required && <span aria-hidden="true"> *</span>}</span>
      {children}
      {hint && !error && <span className="p-field__hint">{hint}</span>}
      {error && <span className="p-field__error">{error}</span>}
    </label>
  )
}

export function Stat({ label, value, sub }) {
  return (
    <div className="card">
      <div className="card__label">{label}</div>
      <div className="card__value card__value--sm">{value}</div>
      {sub && <div className="p-stat-sub">{sub}</div>}
    </div>
  )
}
