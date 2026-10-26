'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from '@/lib/router'
import { api } from '../lib/api.js'
import { date } from '../lib/format.js'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import { Field, ErrorBox, Notice } from '../components/portal/ui.jsx'

// Public verification of certificates, result slips and student IDs (spec §9.3, §11). QR codes link here.
export default function Verify() {
  const [params, setParams] = useSearchParams()
  const [code, setCode] = useState(params.get('code') ?? '')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const lookup = useCallback(async (path) => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await api(path))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    const c = params.get('code')
    const s = params.get('student')
    if (c) lookup(`/public/verify/${encodeURIComponent(c.trim())}`)
    else if (s) lookup(`/public/verify-student/${encodeURIComponent(s.trim())}`)
  }, [params, lookup])

  function submit(e) {
    e.preventDefault()
    if (code.trim()) setParams({ code: code.trim().toUpperCase() })
  }

  return (
    <>
      <PageHeader eyebrow="Verification" title="Verify a certificate" intro="Employers and institutions can confirm a certificate or result slip issued by the academy." />
      <section className="section">
        <div className="container auth-wrap">
          <div className="auth-card">
            <form className="p-form" onSubmit={submit} style={{ marginTop: 0 }}>
              <Field label="Certificate number or verification code" hint="Printed at the bottom of the certificate or result slip (e.g. CCA-2026-00012).">
                <input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
              </Field>
              <Button type="submit" block disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Verify'}</Button>
            </form>
            <div style={{ marginTop: 'var(--space-5)' }}>
              {error && (error.status === 404 ? <Notice tone="error">No record matches this code. Check it and try again, or contact the academy.</Notice> : <ErrorBox error={error} />)}
              {result && <VerifyResult r={result} />}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function VerifyResult({ r }) {
  const ok = r.valid !== false && r.status !== 'revoked'
  const rows = [
    ['Name', r.holder],
    ['Student ID', r.studentNumber],
    r.title && ['Award', r.title],
    r.programme && ['Programme', r.programme],
    r.grade && ['Grade', r.grade],
    r.summary?.average != null && ['Average score', `${r.summary.average} (${r.summary.grade})`],
    r.serial && ['Certificate no.', r.serial],
    r.issuedOn && ['Issued', date(r.issuedOn)],
    r.status && !r.type && ['Student status', r.status],
  ].filter(Boolean)
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Notice tone={ok ? 'success' : 'error'}>
        <strong>
          {r.type === 'certificate' ? (ok ? 'Valid certificate' : 'This certificate has been revoked') : r.type === 'result_slip' ? 'Valid result slip' : 'Registered student'}
        </strong>
      </Notice>
      <dl style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', borderBottom: '1px solid var(--color-line)', paddingBottom: 'var(--space-2)' }}>
            <dt className="muted">{k}</dt><dd style={{ fontWeight: 600, textAlign: 'right', textTransform: k === 'Student status' ? 'capitalize' : undefined }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
