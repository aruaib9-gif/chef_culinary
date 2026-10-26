'use client'
import { useState } from 'react'
import { Link } from '@/lib/router'
import { api } from '../../lib/api.js'
import PageHeader from '../../components/ui/PageHeader.jsx'
import Button from '../../components/ui/Button.jsx'
import { Field, ErrorBox, Notice } from '../../components/portal/ui.jsx'

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState('')
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api('/auth/forgot-password', { method: 'POST', body: { identifier: identifier.trim() } })
      setDone(res.message)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader eyebrow="Student portal" title="Reset your password" />
      <section className="section">
        <div className="container auth-wrap">
          <div className="auth-card">
            <h2>Forgot your password?</h2>
            <p className="muted">Enter your student ID or email. We’ll email you a link to choose a new password.</p>
            {done ? (
              <div className="p-form"><Notice tone="success">{done} Check your inbox (and spam folder).</Notice></div>
            ) : (
              <form className="p-form" onSubmit={submit} noValidate>
                <ErrorBox error={error} />
                <Field label="Student ID or email" required>
                  <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoFocus required />
                </Field>
                <Button type="submit" block disabled={busy || !identifier.trim()}>{busy ? 'Sending…' : 'Send reset link'}</Button>
              </form>
            )}
            <div className="auth-foot">
              <span>No access to your email? Visit or call the academy office and staff can reset it for you.</span>
              <Link to="/portal/login">Back to sign in</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
