'use client'
// A student's fee account: charges, credits, payments, receipts, refunds (spec §9.4).
import { useEffect, useState } from 'react'
import { Link } from '@/lib/router'
import { useApi } from '../lib/useApi.js'
import { api, fetchFile, uploadFile } from '../lib/api.js'
import { money, date, humanize } from '../lib/format.js'
import { Loading, ErrorBox, Badge, Modal, Field, Stat, useAction } from '../components/ui.jsx'

export const CATEGORIES = ['tuition', 'application', 'registration', 'materials', 'uniform', 'project', 'short_course', 'event', 'certificate', 'other']
export const METHODS = ['cash', 'transfer', 'bank_deposit', 'pos', 'cheque']

export default function StudentFinance({ studentId, onChange }) {
  const { data, error, loading, reload } = useApi(`/admin/finance/students/${studentId}`)
  const [modal, setModal] = useState(null)
  const action = useAction()
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const refresh = () => { reload(); onChange?.() }
  const { account, schedule, invoices, payments } = data

  async function voidInvoice(inv) {
    const reason = window.prompt(`Void "${inv.description}"? Enter a reason:`)
    if (reason && (await action.run(() => api(`/admin/finance/invoices/${inv.id}/void`, { method: 'POST', body: { reason } })))) refresh()
  }
  async function refund(p) {
    const reason = window.prompt(`Mark ${money(p.amount_kobo)} (${p.receipt_number}) as refunded? Enter a reason:`)
    if (reason && (await action.run(() => api(`/admin/finance/payments/${p.id}/refund`, { method: 'POST', body: { reason } })))) refresh()
  }

  return (
    <div className="a-stack">
      <div className="kpis">
        <Stat label="Charges" value={money(account.chargesKobo)} />
        <Stat label="Discounts / scholarships / sponsor" value={money(account.creditsKobo)} />
        <Stat label="Paid" value={money(account.paidKobo)} />
        <Stat label="Balance" value={money(account.balanceKobo)} tone={account.balanceKobo > 0 ? 'warn' : undefined} />
      </div>
      <ErrorBox error={action.error} />
      <div className="a-row">
        <button type="button" className="a-btn" onClick={() => setModal('payment')}>Record payment</button>
        <button type="button" className="a-btn a-btn--ghost" onClick={() => setModal('charge')}>Add charge</button>
        <button type="button" className="a-btn a-btn--ghost" onClick={() => setModal('credit')}>Add discount / scholarship</button>
      </div>

      <h3 className="a-section-title">Instalment schedule</h3>
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Item</th><th>Due</th><th className="num">Amount</th><th className="num">Outstanding</th><th>Status</th></tr></thead>
          <tbody>
            {schedule.length === 0 && <tr><td colSpan={5} className="a-empty">No charges.</td></tr>}
            {schedule.map((s) => <tr key={s.id}><td>{s.description}</td><td>{date(s.due_date)}</td><td className="num">{money(s.amount_kobo)}</td><td className="num">{money(s.outstanding_kobo)}</td><td><Badge status={s.status} /></td></tr>)}
          </tbody>
        </table>
      </div>

      <h3 className="a-section-title">Charges & credits</h3>
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Date</th><th>Description</th><th>Type</th><th className="num">Amount</th><th>By</th><th /></tr></thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan={6} className="a-empty">None.</td></tr>}
            {invoices.map((i) => (
              <tr key={i.id} style={i.voided_at ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                <td className="nowrap">{date(i.created_at)}</td>
                <td>{i.description}<div className="a-meta">{humanize(i.category)}{i.due_date ? ` · due ${date(i.due_date)}` : ''}{i.void_reason ? ` · voided: ${i.void_reason}` : ''}</div></td>
                <td>{i.kind === 'charge' ? 'Charge' : <Badge status="success">{humanize(i.kind)}</Badge>}</td>
                <td className="num">{i.kind === 'charge' ? '' : '−'}{money(i.amount_kobo)}</td>
                <td>{i.created_by_name ?? 'System'}</td>
                <td>{!i.voided_at && <button type="button" className="a-link" onClick={() => voidInvoice(i)}>Void</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="a-section-title">Payments</h3>
      <PaymentsTable rows={payments} onRefund={refund} onChanged={refresh} />

      {modal === 'payment' && <RecordPaymentModal studentId={studentId} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh() }} />}
      {(modal === 'charge' || modal === 'credit') && <InvoiceModal studentId={studentId} credit={modal === 'credit'} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh() }} />}
    </div>
  )
}

export function PaymentsTable({ rows, onRefund, showStudent, onChanged }) {
  return (
    <div className="a-table-wrap">
      <table className="a-table">
        <thead><tr><th>Date</th>{showStudent && <th>Student</th>}<th>Purpose</th><th>Method</th><th>Reference / receipt</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={showStudent ? 8 : 7} className="a-empty">No payments.</td></tr>}
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="nowrap">{date(p.paid_at ?? p.created_at)}</td>
              {showStudent && <td><Link to={`/students/${p.student_id}`}>{p.first_name} {p.last_name}</Link><div className="a-meta">{p.student_number}</div></td>}
              <td>{p.purpose}{p.recorded_by_name && <div className="a-meta">Recorded by {p.recorded_by_name}</div>}</td>
              <td>{humanize(p.method)}{p.gateway === 'paystack' && <div className="a-meta">Paystack</div>}</td>
              <td className="nowrap">{p.receipt_number ?? p.reference}</td>
              <td className="num">{money(p.amount_kobo)}</td>
              <td><Badge status={p.status} /></td>
              <td className="nowrap">
                {['success', 'refunded'].includes(p.status) && <button type="button" className="a-link" onClick={() => fetchFile(`/admin/finance/payments/${p.id}/receipt.pdf`, { open: true })}>Receipt</button>}
                {p.proof_file_id && <> · <button type="button" className="a-link" onClick={() => fetchFile(`/admin/finance/payments/${p.id}/proof`, { open: true })}>Proof</button></>}
                {p.status === 'success' && onRefund && <> · <button type="button" className="a-link" onClick={() => onRefund(p)}>Refund</button></>}
                {p.status === 'pending' && p.gateway === 'paystack' && <> · <button type="button" className="a-link" onClick={() => api(`/admin/finance/payments/${p.id}/verify`, { method: 'POST' }).then(() => onChanged?.()).catch((e) => window.alert(e.message))}>Re-check</button></>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Manual (offline) payment with optional proof upload. Without studentId, shows a student search. */
export function RecordPaymentModal({ studentId, onClose, onSaved }) {
  const [form, setForm] = useState({ studentId: studentId ?? '', amount: '', method: 'bank_deposit', purpose: 'School fees', reference: '', paidAt: new Date().toISOString().slice(0, 10), notes: '' })
  const [proof, setProof] = useState(null)
  const action = useAction()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function save() {
    const ok = await action.run(async () => {
      const proofFileId = proof ? await uploadFile(proof, 'payment_proof') : null
      const { amount, ...rest } = form
      return api('/admin/finance/payments', { method: 'POST', body: { ...rest, amountKobo: Math.round(Number(amount) * 100), proofFileId } })
    })
    if (ok) onSaved()
  }

  return (
    <Modal title="Record payment" onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        {!studentId && <StudentPicker value={form.studentId} onChange={(v) => setForm({ ...form, studentId: v })} error={action.errors.studentId} />}
        <div className="a-form__row">
          <Field label="Amount (₦)" required error={action.errors.amountKobo}><input type="number" min="1" step="0.01" value={form.amount} onChange={set('amount')} /></Field>
          <Field label="Method"><select value={form.method} onChange={set('method')}>{METHODS.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}</select></Field>
          <Field label="Date paid"><input type="date" value={form.paidAt} onChange={set('paidAt')} /></Field>
        </div>
        <Field label="Purpose" required error={action.errors.purpose}><input value={form.purpose} onChange={set('purpose')} /></Field>
        <Field label="Bank / teller reference" hint="Leave blank to use the receipt number."><input value={form.reference} onChange={set('reference')} /></Field>
        <Field label="Proof of payment" hint="Teller, transfer screenshot or PDF (max 5 MB)."><input type="file" accept="image/*,application/pdf" onChange={(e) => setProof(e.target.files[0] ?? null)} /></Field>
        <Field label="Notes"><textarea value={form.notes} onChange={set('notes')} /></Field>
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy || !form.studentId || !form.amount} onClick={save}>Record & issue receipt</button>
        </div>
      </div>
    </Modal>
  )
}

export function StudentPicker({ value, onChange, error }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [picked, setPicked] = useState(null)
  useEffect(() => {
    if (q.trim().length < 2) return setResults([])
    const t = setTimeout(() => api(`/admin/students?q=${encodeURIComponent(q)}&pageSize=8`).then((r) => setResults(r.items)).catch(() => {}), 300)
    return () => clearTimeout(t)
  }, [q])
  if (value && picked) {
    return (
      <Field label="Student">
        <div className="a-row"><strong>{picked.first_name} {picked.last_name}</strong><span className="a-meta">{picked.student_number}</span><button type="button" className="a-link" onClick={() => { setPicked(null); onChange('') }}>Change</button></div>
      </Field>
    )
  }
  return (
    <Field label="Student" error={error} required>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or student ID…" />
      {results.length > 0 && (
        <ul className="panel" style={{ listStyle: 'none', padding: 'var(--space-2)', display: 'grid', gap: 2 }}>
          {results.map((s) => (
            <li key={s.id}><button type="button" className="a-link" style={{ textDecoration: 'none' }} onClick={() => { setPicked(s); onChange(s.id) }}>{s.first_name} {s.last_name} · {s.student_number} · {s.cohort_name ?? 'no cohort'}</button></li>
          ))}
        </ul>
      )}
    </Field>
  )
}

function InvoiceModal({ studentId, credit, onClose, onSaved }) {
  const [form, setForm] = useState({ description: '', category: credit ? 'tuition' : 'other', kind: credit ? 'discount' : 'charge', amount: '', dueDate: '' })
  const action = useAction()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const save = async () => {
    if (await action.run(() => api('/admin/finance/invoices', { method: 'POST', body: { studentId, description: form.description, category: form.category, kind: form.kind, amountKobo: Math.round(Number(form.amount) * 100), dueDate: form.dueDate } }))) onSaved()
  }
  return (
    <Modal title={credit ? 'Add discount / scholarship / sponsor credit' : 'Add charge'} onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <Field label="Description" required error={action.errors.description}><input value={form.description} onChange={set('description')} placeholder={credit ? 'e.g. Early-bird discount' : 'e.g. Chef uniform'} /></Field>
        <div className="a-form__row">
          {credit ? (
            <Field label="Type"><select value={form.kind} onChange={set('kind')}><option value="discount">Discount</option><option value="scholarship">Scholarship</option><option value="sponsor">Sponsor-paid</option></select></Field>
          ) : (
            <Field label="Category"><select value={form.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
          )}
          <Field label="Amount (₦)" required error={action.errors.amountKobo}><input type="number" min="1" step="0.01" value={form.amount} onChange={set('amount')} /></Field>
          {!credit && <Field label="Due date"><input type="date" value={form.dueDate} onChange={set('dueDate')} /></Field>}
        </div>
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy || !form.description || !form.amount} onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  )
}
