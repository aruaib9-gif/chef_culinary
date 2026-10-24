import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../lib/useApi.js'
import { api, fetchFile } from '../lib/api.js'
import { money, date, humanize } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Badge, Pagination, SearchInput, ProgrammeSelect, CohortSelect, Modal, Field, Checkbox, Notice, Tabs, Stat, useAction } from '../components/ui.jsx'
import { PaymentsTable, RecordPaymentModal, CATEGORIES } from './StudentFinance.jsx'

const iso = (d) => d.toISOString().slice(0, 10)
const monthStart = () => { const d = new Date(); d.setDate(1); return iso(d) }

// Finance management (spec §9.4, §10).
export default function Finance() {
  const [tab, setTab] = useState('payments')
  const [recording, setRecording] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [key, setKey] = useState(0)
  return (
    <>
      <PageHeader
        title="Payments & fees"
        actions={<><button type="button" className="a-btn a-btn--ghost" onClick={() => setBulk(true)}>Charge a cohort</button><button type="button" className="a-btn" onClick={() => setRecording(true)}>Record payment</button></>}
      />
      <Tabs tabs={[['payments', 'Payments'], ['debtors', 'Debtors & reminders'], ['report', 'Income report'], ['sponsors', 'Sponsor invoices']]} value={tab} onChange={setTab} />
      <div key={key}>
        {tab === 'payments' && <Payments />}
        {tab === 'debtors' && <Debtors />}
        {tab === 'report' && <IncomeReport />}
        {tab === 'sponsors' && <SponsorInvoices />}
      </div>
      {recording && <RecordPaymentModal onClose={() => setRecording(false)} onSaved={() => { setRecording(false); setKey((k) => k + 1) }} />}
      {bulk && <BulkChargeModal onClose={() => setBulk(false)} onSaved={() => { setBulk(false); setKey((k) => k + 1) }} />}
    </>
  )
}

function Payments() {
  const [f, setF] = useState({ page: 1, q: '', status: '', method: '', from: '', to: '', programmeId: '' })
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString()
  const { data, error, loading, reload } = useApi(`/admin/finance/payments?${qs}`)
  const action = useAction()
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }))
  async function refund(p) {
    const reason = window.prompt(`Refund ${money(p.amount_kobo)} to ${p.first_name} ${p.last_name}? Reason:`)
    if (reason && (await action.run(() => api(`/admin/finance/payments/${p.id}/refund`, { method: 'POST', body: { reason } })))) reload()
  }
  return (
    <>
      <div className="a-filters">
        <SearchInput value={f.q} onChange={set('q')} placeholder="Student, receipt or reference" />
        <select className="a-input" value={f.status} onChange={(e) => set('status')(e.target.value)}><option value="">All statuses</option>{['success', 'pending', 'failed', 'refunded', 'cancelled'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
        <select className="a-input" value={f.method} onChange={(e) => set('method')(e.target.value)}><option value="">All methods</option>{['card', 'transfer', 'ussd', 'bank', 'cash', 'bank_deposit', 'pos', 'cheque'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
        <ProgrammeSelect value={f.programmeId} onChange={set('programmeId')} />
        <input className="a-input" type="date" value={f.from} onChange={(e) => set('from')(e.target.value)} aria-label="From" />
        <input className="a-input" type="date" value={f.to} onChange={(e) => set('to')(e.target.value)} aria-label="To" />
        <button type="button" className="a-btn a-btn--ghost" onClick={() => fetchFile(`/admin/finance/payments/export.csv?${qs}`)}>Export CSV</button>
      </div>
      <ErrorBox error={error || action.error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <p className="a-meta" style={{ marginBottom: 'var(--space-2)' }}>Received (matching filters): <strong>{money(data.receivedKobo)}</strong></p>
          <PaymentsTable rows={data.items} showStudent onRefund={refund} onChanged={reload} />
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={set('page')} />
        </>
      )}
    </>
  )
}

function Debtors() {
  const [cohortId, setCohortId] = useState('')
  const { data, error, loading, reload } = useApi(`/admin/finance/debtors${cohortId ? `?cohortId=${cohortId}` : ''}`)
  const [overdueOnly, setOverdueOnly] = useState(true)
  const action = useAction()
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <>
      <div className="a-filters">
        <CohortSelect value={cohortId} onChange={setCohortId} />
        <button type="button" className="a-btn a-btn--ghost" onClick={() => fetchFile(`/admin/finance/debtors.csv${cohortId ? `?cohortId=${cohortId}` : ''}`)}>Export CSV</button>
        <Checkbox label="Only students with overdue instalments" checked={overdueOnly} onChange={setOverdueOnly} />
        <button type="button" className="a-btn" disabled={action.busy || !data.rows.length} onClick={async () => {
          if (!window.confirm('Email payment reminders now?')) return
          const r = await action.run(() => api('/admin/finance/reminders', { method: 'POST', body: { cohortId: cohortId || null, overdueOnly } }))
          if (r) window.alert(`${r.sent} reminder(s) sent.`)
        }}>Send reminders</button>
      </div>
      <ErrorBox error={action.error} />
      <div className="kpis" style={{ marginBottom: 'var(--space-4)' }}>
        <Stat label="Students owing" value={data.rows.length} />
        <Stat label="Total outstanding" value={money(data.totalKobo)} tone="warn" />
      </div>
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Student</th><th>Programme / cohort</th><th>Contact</th><th>Earliest due</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {data.rows.length === 0 && <tr><td colSpan={5} className="a-empty">No outstanding balances. 🎉</td></tr>}
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/students/${r.id}`}>{r.first_name} {r.last_name}</Link><div className="a-meta">{r.student_number}</div></td>
                <td>{r.programme_name}<div className="a-meta">{r.cohort_name}</div></td>
                <td>{r.phone ?? '—'}<div className="a-meta">{r.email ?? ''}</div></td>
                <td className="nowrap">{r.earliest_due ? <Badge status={r.earliest_due < iso(new Date()) ? 'overdue' : 'pending'}>{date(r.earliest_due)}</Badge> : '—'}</td>
                <td className="num"><strong>{money(r.balance_kobo)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function IncomeReport() {
  const [f, setF] = useState({ from: monthStart(), to: iso(new Date()), groupBy: 'day' })
  const qs = new URLSearchParams(f).toString()
  const { data, error, loading, reload } = useApi(`/admin/finance/report?${qs}`)
  const max = Math.max(1, ...(data?.rows ?? []).map((r) => Number(r.total_kobo)))
  return (
    <>
      <div className="a-filters">
        <input className="a-input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" />
        <input className="a-input" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" />
        <select className="a-input" value={f.groupBy} onChange={(e) => setF({ ...f, groupBy: e.target.value })}>
          {[['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['programme', 'By programme'], ['method', 'By payment method'], ['category', 'By fee type']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="button" className="a-btn a-btn--ghost" onClick={() => fetchFile(`/admin/finance/report.csv?${qs}`)}>Export CSV</button>
        <button type="button" className="a-btn a-btn--ghost" onClick={() => window.print()}>Print / PDF</button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <div className="panel">
          <h3 className="a-section-title" style={{ marginTop: 0 }}>Income {date(data.from)} – {date(data.to)}: {money(data.totalKobo)}</h3>
          {data.rows.length === 0 ? <p className="muted">No payments in this period.</p> : (
            <div className="a-bars">
              {data.rows.map((r) => (
                <div key={r.label} className="a-bar" style={{ gridTemplateColumns: '160px 1fr 150px' }}>
                  <span>{humanize(String(r.label))}</span>
                  <div className="a-bar__track"><div className="a-bar__fill" style={{ width: `${(Number(r.total_kobo) / max) * 100}%` }} /></div>
                  <span style={{ textAlign: 'right' }}>{money(r.total_kobo)} <span className="a-meta">({r.payments})</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function SponsorInvoices() {
  const { data, error, loading, reload } = useApi('/admin/finance/sponsor-invoices')
  const [adding, setAdding] = useState(false)
  const action = useAction()
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <>
      <div className="a-row" style={{ marginBottom: 'var(--space-3)' }}><button type="button" className="a-btn" onClick={() => setAdding(true)}>New sponsor invoice</button></div>
      <Notice>Invoice organisations that pay for a whole cohort (e.g. SUPA ITF). Students in sponsored cohorts get a matching sponsor credit automatically.</Notice>
      <ErrorBox error={action.error} />
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Invoice</th><th>Sponsor</th><th>Cohort</th><th>Issued / due</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.length === 0 && <tr><td colSpan={7} className="a-empty">No sponsor invoices.</td></tr>}
            {data.map((i) => (
              <tr key={i.id}>
                <td><button type="button" className="a-link" onClick={() => fetchFile(`/admin/finance/sponsor-invoices/${i.id}/pdf`, { open: true })}>{i.invoice_number}</button><div className="a-meta">{i.description}</div></td>
                <td>{i.sponsor_name}<div className="a-meta">{i.sponsor_email ?? ''}</div></td>
                <td>{i.cohort_name ?? '—'}</td>
                <td className="nowrap">{date(i.issued_on)}<div className="a-meta">Due {date(i.due_date)}</div></td>
                <td className="num">{money(i.amount_kobo)}</td>
                <td><Badge status={i.status} /></td>
                <td>
                  <select className="a-input" value={i.status} onChange={async (e) => { if (await action.run(() => api(`/admin/finance/sponsor-invoices/${i.id}`, { method: 'PATCH', body: { status: e.target.value } }))) reload() }} aria-label="Status">
                    {['unpaid', 'paid', 'cancelled'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <SponsorModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} />}
    </>
  )
}

function SponsorModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ cohortId: '', sponsorName: '', sponsorEmail: '', description: '', amount: '', dueDate: '' })
  const action = useAction()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <Modal title="New sponsor invoice" onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <Field label="Cohort"><CohortSelect value={form.cohortId} onChange={(v) => setForm({ ...form, cohortId: v })} allowEmpty="—" className="" /></Field>
        <div className="a-form__row">
          <Field label="Sponsor organisation" required error={action.errors.sponsorName}><input value={form.sponsorName} onChange={set('sponsorName')} /></Field>
          <Field label="Sponsor email" error={action.errors.sponsorEmail}><input type="email" value={form.sponsorEmail} onChange={set('sponsorEmail')} /></Field>
        </div>
        <Field label="Description" required error={action.errors.description}><input value={form.description} onChange={set('description')} placeholder="Tuition for 25 trainees, Batch 3" /></Field>
        <div className="a-form__row">
          <Field label="Amount (₦)" required error={action.errors.amountKobo}><input type="number" min="1" value={form.amount} onChange={set('amount')} /></Field>
          <Field label="Due date"><input type="date" value={form.dueDate} onChange={set('dueDate')} /></Field>
        </div>
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy} onClick={async () => { if (await action.run(() => api('/admin/finance/sponsor-invoices', { method: 'POST', body: { ...form, amountKobo: Math.round(Number(form.amount) * 100) } }))) onSaved() }}>Create invoice</button>
        </div>
      </div>
    </Modal>
  )
}

function BulkChargeModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ cohortId: '', description: '', category: 'uniform', amount: '', dueDate: '' })
  const action = useAction()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <Modal title="Charge every student in a cohort" onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <Field label="Cohort" required><CohortSelect value={form.cohortId} onChange={(v) => setForm({ ...form, cohortId: v })} allowEmpty="Select…" className="" /></Field>
        <Field label="Description" required error={action.errors.description}><input value={form.description} onChange={set('description')} placeholder="e.g. Chef uniform and knife kit" /></Field>
        <div className="a-form__row">
          <Field label="Fee type"><select value={form.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
          <Field label="Amount per student (₦)" required><input type="number" min="1" value={form.amount} onChange={set('amount')} /></Field>
          <Field label="Due date"><input type="date" value={form.dueDate} onChange={set('dueDate')} /></Field>
        </div>
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy || !form.cohortId || !form.amount || !form.description} onClick={async () => {
            const r = await action.run(() => api('/admin/finance/invoices/bulk', { method: 'POST', body: { cohortId: form.cohortId, description: form.description, category: form.category, amountKobo: Math.round(Number(form.amount) * 100), dueDate: form.dueDate } }))
            if (r) { window.alert(`Charged ${r.created} student(s).`); onSaved() }
          }}>Charge cohort</button>
        </div>
      </div>
    </Modal>
  )
}
