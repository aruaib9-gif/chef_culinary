'use client'
// Admin UI kit: headers, feedback, form fields, modal, tables, pagination, selects.
import { useEffect, useRef, useState } from 'react'
import { useLookups } from '../lib/auth.jsx'

export function PageHeader({ title, intro, actions }) {
  return (
    <div className="a-head">
      <div>
        <h1>{title}</h1>
        {intro && <p className="muted">{intro}</p>}
      </div>
      {actions && <div className="a-actions">{actions}</div>}
    </div>
  )
}

export function Loading({ label = 'Loading…' }) {
  return <div className="a-loading" role="status"><span className="a-spinner" aria-hidden="true" />{label}</div>
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="a-alert a-alert--error" role="alert">
      <span>{error.message ?? String(error)}</span>
      {onRetry && <button type="button" className="a-link" onClick={onRetry}>Retry</button>}
    </div>
  )
}

// Children sit in one block so bold text, links and code read as a single sentence.
export function Notice({ tone = 'info', children }) {
  return (
    <div className={`a-alert a-alert--${tone}`} role="status">
      <div className="a-alert__body">{children}</div>
    </div>
  )
}

const TONES = {
  success: 'ok', paid: 'ok', published: 'ok', completed: 'ok', admitted: 'ok', enrolled: 'ok', present: 'ok', active: 'ok', valid: 'ok', sent: 'ok', graduated: 'ok', applied: 'ok',
  pending: 'warn', draft: 'warn', in_progress: 'warn', under_review: 'warn', waitlisted: 'warn', late: 'warn', open: 'warn', unpaid: 'warn', received: 'warn', new: 'warn', planned: 'warn', contacted: 'info', interested: 'info', logged: 'warn', suspended: 'warn',
  failed: 'bad', declined: 'bad', rejected: 'bad', absent: 'bad', revoked: 'bad', overdue: 'bad', not_interested: 'muted', withdrawn: 'muted', archived: 'muted', refunded: 'muted', cancelled: 'muted', excused: 'muted',
}

export function Badge({ status, children }) {
  return <span className={`a-badge a-badge--${TONES[status] ?? 'info'}`}>{children ?? String(status ?? '').replace(/_/g, ' ')}</span>
}

export function Field({ label, error, hint, required, children, className = '' }) {
  return (
    <label className={`a-field ${className}${error ? ' has-error' : ''}`}>
      <span className="a-field__label">{label}{required && <span aria-hidden="true"> *</span>}</span>
      {children}
      {hint && !error && <span className="a-field__hint">{hint}</span>}
      {error && <span className="a-field__error">{error}</span>}
    </label>
  )
}

export function Checkbox({ label, checked, onChange, hint }) {
  return (
    <label className="a-check">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="a-field__hint" style={{ display: 'block' }}>{hint}</span>}</span>
    </label>
  )
}

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null)
  useEffect(() => {
    const prev = document.activeElement
    ref.current?.querySelector('input, select, textarea, button')?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [onClose])
  return (
    <div className="a-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`a-modal__box${wide ? ' a-modal__box--wide' : ''}`} ref={ref}>
        <div className="a-modal__head">
          <h2>{title}</h2>
          <button type="button" className="a-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="a-modal__body">{children}</div>
      </div>
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return <p className="a-meta">{total} record{total === 1 ? '' : 's'}</p>
  return (
    <div className="a-pager">
      <span className="a-meta">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <button type="button" className="a-btn a-btn--ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <button type="button" className="a-btn a-btn--ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="a-tabs" role="tablist">
      {tabs.map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} onClick={() => onChange(key)}>{label}</button>
      ))}
    </div>
  )
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className={`panel a-stat${tone ? ` a-stat--${tone}` : ''}`}>
      <div className="panel__label">{label}</div>
      <div className="panel__value">{value}</div>
      {sub && <div className="a-meta">{sub}</div>}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => {
    const t = setTimeout(() => text !== (value ?? '') && onChange(text), 350)
    return () => clearTimeout(t)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  return <input className="a-input a-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
}

export function ProgrammeSelect({ value, onChange, allowEmpty = 'All programmes', className = 'a-input' }) {
  const { programmes } = useLookups()
  return (
    <select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || '')}>
      {allowEmpty !== false && <option value="">{allowEmpty}</option>}
      {programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )
}

export function CohortSelect({ value, onChange, programmeId, allowEmpty = 'All cohorts', className = 'a-input' }) {
  const { cohorts } = useLookups()
  const list = programmeId ? cohorts.filter((c) => c.programme_id === String(programmeId)) : cohorts
  return (
    <select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || '')}>
      {allowEmpty !== false && <option value="">{allowEmpty}</option>}
      {list.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.programme_name}{c.status !== 'active' ? ` (${c.status})` : ''}</option>)}
    </select>
  )
}

export function CourseSelect({ value, onChange, programmeId, allowEmpty = 'Select course', className = 'a-input' }) {
  const { courses } = useLookups()
  const list = programmeId ? courses.filter((c) => c.programme_ids.includes(String(programmeId))) : courses
  return (
    <select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || '')}>
      {allowEmpty !== false && <option value="">{allowEmpty}</option>}
      {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  )
}

/** Small hook for form submit state: run(fn) sets busy/error/ok. */
export function useAction() {
  const [state, setState] = useState({})
  async function run(fn, okMessage) {
    setState({ busy: true })
    try {
      const result = await fn()
      setState({ ok: okMessage ?? true })
      return result
    } catch (error) {
      setState({ error })
      return undefined
    }
  }
  return { ...state, errors: state.error?.details ?? {}, run, reset: () => setState({}) }
}
