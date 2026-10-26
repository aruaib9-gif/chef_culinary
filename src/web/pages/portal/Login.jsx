'use client'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams, safeNext } from '@/lib/router'
import { useAuth } from '../../lib/auth.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import Button from '../../components/ui/Button.jsx'
import PasswordInput from '../../components/portal/PasswordInput.jsx'
import { Field, ErrorBox, Notice } from '../../components/portal/ui.jsx'

// Student / applicant sign-in with student ID or email (spec §8.1), plus the optional OTP step.
export default function Login() {
  const { user, login, verifyOtp } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const from = safeNext(params.get('next')) || '/portal'
  const [form, setForm] = useState({ identifier: '', password: '' })
  const [otp, setOtp] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (user && !otp) return <Navigate to={from} replace />

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = otp ? await verifyOtp(otp.challenge, code) : await login(form.identifier.trim(), form.password)
      if (res.otpRequired) setOtp(res)
      else navigate(from, { replace: true })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader eyebrow="Student portal" title="Sign in" intro="Access your dashboard, results, payments, timetable and more." />
      <section className="section">
        <div className="container auth-wrap">
          <div className="auth-card">
            {otp ? (
              <>
                <h2>Check your email</h2>
                <p className="muted">We sent a 6-digit sign-in code to {otp.sentTo}. It expires in 10 minutes.</p>
                <form className="p-form" onSubmit={submit} noValidate>
                  <ErrorBox error={error} />
                  <Field label="Sign-in code" required>
                    <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus required />
                  </Field>
                  <Button type="submit" block disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify and sign in'}</Button>
                  <button type="button" className="p-link-btn" onClick={() => { setOtp(null); setCode(''); setError(null) }}>Use a different account</button>
                </form>
              </>
            ) : (
              <>
                <h2>Welcome back</h2>
                <p className="muted">Sign in with your student ID (e.g. CCA/2026/0001) or email address.</p>
                {params.get('reset') && <Notice tone="success">Your password has been updated. Please sign in.</Notice>}
                <form className="p-form" onSubmit={submit} noValidate>
                  <ErrorBox error={error} />
                  <Field label="Student ID or email" required>
                    <input value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} autoComplete="username" autoFocus required />
                  </Field>
                  <Field label="Password" required>
                    <PasswordInput value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" required />
                  </Field>
                  <Button type="submit" block disabled={busy || !form.identifier || !form.password}>{busy ? 'Signing in…' : 'Sign in'}</Button>
                </form>
                <div className="auth-foot">
                  <Link to="/portal/forgot-password">Forgot your password?</Link>
                  <span>New applicant? <Link to={params.get('next') ? `/portal/signup?next=${encodeURIComponent(from)}` : '/portal/signup'}>Create an account</Link> to apply online.</span>
                  <span>Staff member? <Link to="/admin/login">Sign in to the admin</Link>.</span>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
