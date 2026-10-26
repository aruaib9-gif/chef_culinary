'use client'
import { useState } from 'react'
import { useApi } from '../lib/useApi.js'
import { api, fetchFile } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { date, dateTime, humanize } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Badge, Pagination, SearchInput, Modal, Field, useAction, Notice } from '../components/ui.jsx'

const STATUSES = ['new', 'contacted', 'interested', 'applied', 'enrolled', 'not_interested']
const SOURCES = ['enquiry', 'brochure', 'visit', 'newsletter', 'popup', 'catering', 'employer', 'event']

// Leads dashboard with follow-up status, notes, export and bulk actions (spec §6.2, §9.5).
export default function Leads() {
  const [f, setF] = useState({ page: 1, q: '', status: '', source: '' })
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString()
  const { data, error, loading, reload, setData } = useApi(`/admin/leads?${qs}`)
  const [selected, setSelected] = useState(new Set())
  const [editing, setEditing] = useState(null)
  const [bulk, setBulk] = useState('')
  const { isSuper } = useAuth()
  const set = (k) => (v) => { setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 })); setSelected(new Set()) }

  async function quickStatus(lead, status) {
    const row = await api(`/admin/leads/${lead.id}`, { method: 'PATCH', body: { status, followUpOn: lead.follow_up_on } })
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === row.id ? row : x)) }))
  }

  async function applyBulk() {
    if (!bulk || !selected.size) return
    await api('/admin/leads/bulk-status', { method: 'POST', body: { ids: [...selected], status: bulk } })
    setSelected(new Set())
    setBulk('')
    reload()
  }

  const counts = Object.fromEntries((data?.statusCounts ?? []).map((c) => [c.status, c.n]))
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <>
      <PageHeader
        title="Leads & enquiries"
        intro="Every enquiry, brochure download, visit booking and newsletter sign-up from the website."
        actions={<button type="button" className="a-btn a-btn--ghost" onClick={() => fetchFile(`/admin/leads/export.csv?${qs}`)}>Export CSV</button>}
      />
      <div className="a-filters">
        <SearchInput value={f.q} onChange={set('q')} placeholder="Search name, email, phone…" />
        <select className="a-input" value={f.status} onChange={(e) => set('status')(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)} {counts[s] ? `(${counts[s]})` : ''}</option>)}
        </select>
        <select className="a-input" value={f.source} onChange={(e) => set('source')(e.target.value)}>
          <option value="">All sources</option>
          {SOURCES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
        {selected.size > 0 && (
          <>
            <span className="a-meta">{selected.size} selected</span>
            <select className="a-input" value={bulk} onChange={(e) => setBulk(e.target.value)}>
              <option value="">Set status…</option>
              {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select>
            <button type="button" className="a-btn a-btn--sm" disabled={!bulk} onClick={applyBulk}>Apply</button>
          </>
        )}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="a-table-wrap">
            <table className="a-table">
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Select all" checked={data.items.length > 0 && data.items.every((l) => selected.has(l.id))} onChange={(e) => setSelected(e.target.checked ? new Set(data.items.map((l) => l.id)) : new Set())} /></th>
                  <th>Received</th><th>Name</th><th>Contact</th><th>Interest</th><th>Source</th><th>Status</th><th>Follow up</th><th />
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && <tr><td colSpan={9} className="a-empty">No leads match these filters.</td></tr>}
                {data.items.map((l) => (
                  <tr key={l.id}>
                    <td><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.name}`} /></td>
                    <td className="nowrap">{date(l.created_at)}</td>
                    <td><strong>{l.name}</strong>{l.message && <div className="a-meta" title={l.message}>{l.message.slice(0, 60)}{l.message.length > 60 ? '…' : ''}</div>}</td>
                    <td>{l.email && <a href={`mailto:${l.email}`}>{l.email}</a>}{l.phone && <div><a href={`tel:${l.phone}`}>{l.phone}</a> · <a href={`https://wa.me/${l.phone.replace(/\D/g, '').replace(/^0/, '234')}`} target="_blank" rel="noreferrer">WhatsApp</a></div>}</td>
                    <td>{l.programme_interest ?? '—'}{l.preferred_start && <div className="a-meta">Start: {l.preferred_start}</div>}</td>
                    <td>{humanize(l.source)}</td>
                    <td>
                      <select className="a-input" value={l.status} onChange={(e) => quickStatus(l, e.target.value)} aria-label="Status">
                        {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                      </select>
                    </td>
                    <td className="nowrap">{l.follow_up_on ? <Badge status={l.follow_up_on <= new Date().toISOString().slice(0, 10) ? 'overdue' : 'pending'}>{date(l.follow_up_on)}</Badge> : '—'}</td>
                    <td><button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setEditing(l)}>Notes</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={set('page')} />
        </>
      )}
      {editing && <LeadModal lead={editing} canDelete={isSuper} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function LeadModal({ lead, onClose, onSaved, canDelete }) {
  const [form, setForm] = useState({ status: lead.status, notes: lead.notes ?? '', followUpOn: lead.follow_up_on ?? '' })
  const action = useAction()
  return (
    <Modal title={lead.name} onClose={onClose}>
      <div className="a-form">
        <dl className="a-dl">
          <div><dt>Email</dt><dd>{lead.email ?? '—'}</dd></div>
          <div><dt>Phone</dt><dd>{lead.phone ?? '—'}</dd></div>
          <div><dt>Heard about us</dt><dd>{lead.heard_about ?? '—'}</dd></div>
          <div><dt>Received</dt><dd>{dateTime(lead.created_at)}</dd></div>
        </dl>
        {lead.message && <Notice>{lead.message}</Notice>}
        <ErrorBox error={action.error} />
        <div className="a-form__row">
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
          </Field>
          <Field label="Follow up on"><input type="date" value={form.followUpOn} onChange={(e) => setForm({ ...form, followUpOn: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="a-form__foot">
          {canDelete && (
            <button type="button" className="a-btn a-btn--danger" style={{ marginRight: 'auto' }} onClick={() => window.confirm('Permanently delete this lead (e.g. a data-deletion request)?') && action.run(() => api(`/admin/leads/${lead.id}`, { method: 'DELETE' })).then((r) => r && onSaved())}>Delete</button>
          )}
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy} onClick={() => action.run(() => api(`/admin/leads/${lead.id}`, { method: 'PATCH', body: form })).then((r) => r && onSaved())}>Save</button>
        </div>
      </div>
    </Modal>
  )
}
