'use client'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from '@/lib/router'
import { useApi } from '../../lib/useApi.js'
import { api, fetchFile } from '../../lib/api.js'
import { money, date, humanize } from '../../lib/format.js'
import { PageHead, Loading, ErrorBox, Badge, Stat, Notice, Field } from '../../components/portal/ui.jsx'

// Fees, instalments, online payment via Paystack's hosted checkout, receipts (spec §8.4, §10).
export default function Payments() {
  const { data, error, loading, reload } = useApi('/student/payments')
  const [params, setParams] = useSearchParams()
  const [verify, setVerify] = useState(null)
  const verifying = useRef(false)

  // Returning from Paystack: confirm the payment, then refresh the account.
  useEffect(() => {
    const reference = params.get('reference') ?? params.get('trxref')
    if (!reference || verifying.current) return
    verifying.current = true
    setVerify({ state: 'checking' })
    api(`/student/payments/verify/${encodeURIComponent(reference)}`)
      .then((r) => setVerify({ state: r.status, ...r }))
      .catch((e) => setVerify({ state: 'error', message: e.message }))
      .finally(() => {
        setParams({}, { replace: true })
        reload()
      })
  }, [params, setParams, reload])

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { account, schedule, payments, onlinePayments } = data
  const nextDue = schedule.find((s) => s.outstanding_kobo > 0)

  return (
    <div className="portal-page">
      <PageHead title="Payments" intro="Your fees, instalments and payment history." />

      {verify?.state === 'checking' && <Notice>Confirming your payment…</Notice>}
      {verify?.state === 'success' && <Notice tone="success">Payment of {money(verify.amountKobo)} received. Receipt {verify.receiptNumber} has been emailed to you.</Notice>}
      {verify && ['failed', 'cancelled'].includes(verify.state) && <Notice tone="error">The payment was not completed. No money was taken — you can try again.</Notice>}
      {verify?.state === 'pending' && <Notice tone="warn">Your payment is still processing. It will update automatically once confirmed.</Notice>}
      {verify?.state === 'error' && <Notice tone="error">{verify.message}</Notice>}

      <div className="portal-grid">
        <Stat label="Total fees" value={money(account.chargesKobo)} />
        <Stat label="Discounts & sponsorship" value={money(account.creditsKobo)} />
        <Stat label="Amount paid" value={money(account.paidKobo)} />
        <Stat label="Balance" value={money(Math.max(0, account.balanceKobo))} sub={account.balanceKobo < 0 ? `In credit: ${money(-account.balanceKobo)}` : account.nextDue ? `Next due ${date(account.nextDue)}` : null} />
      </div>

      {account.balanceKobo > 0 && <PayCard balance={account.balanceKobo} nextDue={nextDue} enabled={onlinePayments} />}

      {schedule.length > 0 && (
        <section className="portal-page" style={{ gap: 'var(--space-3)' }}>
          <h2 className="portal-card-title">Fee schedule</h2>
          <div className="p-table-wrap">
            <table className="p-table">
              <thead><tr><th>Item</th><th>Due</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Outstanding</th><th>Status</th></tr></thead>
              <tbody>
                {schedule.map((s) => (
                  <tr key={s.id}>
                    <td>{s.description}</td>
                    <td>{date(s.due_date)}</td>
                    <td className="num">{money(s.amount_kobo)}</td>
                    <td className="num">{money(s.paid_kobo)}</td>
                    <td className="num">{money(s.outstanding_kobo)}</td>
                    <td><Badge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="portal-page" style={{ gap: 'var(--space-3)' }}>
        <h2 className="portal-card-title">Payment history</h2>
        {payments.length === 0 ? (
          <div className="card"><p className="muted">No payments recorded yet.</p></div>
        ) : (
          <div className="p-table-wrap">
            <table className="p-table">
              <thead><tr><th>Date</th><th>Description</th><th>Method</th><th className="num">Amount</th><th>Status</th><th>Receipt</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{date(p.paid_at ?? p.created_at)}</td>
                    <td>{p.purpose}</td>
                    <td>{humanize(p.method)}</td>
                    <td className="num">{money(p.amount_kobo)}</td>
                    <td><Badge status={p.status} /></td>
                    <td>
                      {p.status === 'success' ? (
                        <button type="button" className="p-link-btn" onClick={() => fetchFile(`/student/payments/${p.id}/receipt.pdf`)}>{p.receipt_number}</button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="card">
        <h2 className="portal-card-title">Paying at the office or by bank deposit?</h2>
        <p className="muted">Bring your teller or transfer confirmation to the academy office. Once recorded, the payment and its receipt appear here.</p>
      </div>
    </div>
  )
}

function PayCard({ balance, nextDue, enabled }) {
  const [amount, setAmount] = useState(String(Math.round((nextDue?.outstanding_kobo ?? balance) / 100)))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function pay(e) {
    e.preventDefault()
    setError(null)
    const kobo = Math.round(Number(amount) * 100)
    if (!Number.isFinite(kobo) || kobo < 10000) return setError(new Error('Enter at least ₦100'))
    if (kobo > balance) return setError(new Error(`The most you can pay is ${money(balance)}`))
    setBusy(true)
    try {
      const res = await api('/student/payments/initialize', { method: 'POST', body: { amountKobo: kobo } })
      window.location.assign(res.authorizationUrl) // Paystack's secure checkout — card details never touch our server
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2 className="portal-card-title">Make a payment</h2>
      {!enabled ? (
        <p className="muted" style={{ marginTop: 'var(--space-2)' }}>Online payment is not available yet. Please pay at the academy office or by bank transfer, and keep your receipt.</p>
      ) : (
        <form className="p-form" onSubmit={pay} style={{ marginTop: 'var(--space-3)' }}>
          <ErrorBox error={error} />
          <div className="p-form__actions">
            {nextDue && nextDue.outstanding_kobo !== balance && (
              <button type="button" className="p-btn" onClick={() => setAmount(String(nextDue.outstanding_kobo / 100))}>Next instalment · {money(nextDue.outstanding_kobo)}</button>
            )}
            <button type="button" className="p-btn" onClick={() => setAmount(String(balance / 100))}>Full balance · {money(balance)}</button>
          </div>
          <div className="p-form__row">
            <Field label="Amount (₦)" hint="Pay by card, bank transfer or USSD through Paystack.">
              <input type="number" min="100" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
          </div>
          <div><button type="submit" className="p-btn p-btn--primary" disabled={busy}>{busy ? 'Redirecting to Paystack…' : 'Pay securely'}</button></div>
        </form>
      )}
    </div>
  )
}
