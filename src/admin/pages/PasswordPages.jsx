'use client'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from '@/lib/router'
import { api } from '../lib/api.js'
import { Field, ErrorBox, Notice, PasswordInput } from '../components/ui.jsx'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState({})
  async function submit(e) {
    e.preventDefault()
    setState({ busy: true })
    try {
      const r = await api('/auth/forgot-password', { method: 'POST', body: { identifier: email.trim() } })
      setState({ done: r.message })
    } catch (error) {
      setState({ error })
    }
  }
  return (
    <div className="login">
      <form className="panel a-form" onSubmit={submit}>
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>Reset password</h1>
        {state.done ? <Notice tone="success">{state.done}</Notice> : (
          <>
            <ErrorBox error={state.error} />
            <Field label="Staff email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
            <button className="a-btn" type="submit" disabled={state.busy || !email}>Send reset link</button>
          </>
        )}
        <Link to="/login" className="a-meta">Back to sign in</Link>
      </form>
    </div>
  )
}

export function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [pw, setPw] = useState({ password: '', confirm: '' })
  const [state, setState] = useState({})
  async function submit(e) {
    e.preventDefault()
    if (pw.password !== pw.confirm) return setState({ error: new Error('Passwords do not match') })
    setState({ busy: true })
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token: params.get('token'), password: pw.password } })
      navigate('/login?reset=1', { replace: true })
    } catch (error) {
      setState({ error })
    }
  }
  return (
    <div className="login">
      <form className="panel a-form" onSubmit={submit}>
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>{params.get('welcome') ? 'Set your password' : 'Choose a new password'}</h1>
        <ErrorBox error={state.error} />
        <Field label="New password" hint="At least 8 characters, with a letter and a number." error={state.error?.details?.password}>
          <PasswordInput value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} autoComplete="new-password" required autoFocus />
        </Field>
        <Field label="Confirm password"><PasswordInput value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" required /></Field>
        <button className="a-btn" type="submit" disabled={state.busy || !pw.password}>Save password</button>
      </form>
    </div>
  )
}
