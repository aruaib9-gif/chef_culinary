import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { Field, ErrorBox, Notice } from '../components/ui.jsx'

// Staff sign-in with optional emailed OTP (spec §12).
export default function Login() {
  const { user, login, verifyOtp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [otp, setOtp] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={location.state?.from ?? '/'} replace />

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = otp ? await verifyOtp(otp.challenge, code) : await login(form.email.trim(), form.password)
      if (res.otpRequired) setOtp(res)
      else navigate(location.state?.from ?? '/', { replace: true })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="panel a-form" onSubmit={submit} noValidate>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Admin sign in</h1>
          <p className="muted">The Chefs Culinary Academy back office</p>
        </div>
        {location.state?.reset && <Notice tone="success">Password saved. Please sign in.</Notice>}
        <ErrorBox error={error} />
        {otp ? (
          <>
            <p className="muted">Enter the 6-digit code we emailed to {otp.sentTo}.</p>
            <Field label="Sign-in code"><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus /></Field>
            <button className="a-btn" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify'}</button>
            <button type="button" className="a-link" onClick={() => { setOtp(null); setCode('') }}>Start again</button>
          </>
        ) : (
          <>
            <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="username" autoFocus required /></Field>
            <Field label="Password"><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" required /></Field>
            <button className="a-btn" type="submit" disabled={busy || !form.email || !form.password}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <Link to="/forgot-password" className="a-meta">Forgot password?</Link>
          </>
        )}
      </form>
    </div>
  )
}
