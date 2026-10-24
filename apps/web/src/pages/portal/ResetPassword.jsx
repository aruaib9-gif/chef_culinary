import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api.js'
import PageHeader from '../../components/ui/PageHeader.jsx'
import Button from '../../components/ui/Button.jsx'
import PasswordInput from '../../components/portal/PasswordInput.jsx'
import { Field, ErrorBox } from '../../components/portal/ui.jsx'

// Used for both "forgot password" links and first-time account setup links (?welcome=1).
export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const welcome = params.get('welcome') === '1'
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (password !== confirm) return setErrors({ confirm: 'Passwords do not match' })
    setErrors({})
    setError(null)
    setBusy(true)
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } })
      navigate('/portal/login', { replace: true, state: { reset: true } })
    } catch (err) {
      setErrors(err.details ?? {})
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader eyebrow="Student portal" title={welcome ? 'Set up your account' : 'Choose a new password'} />
      <section className="section">
        <div className="container auth-wrap">
          <div className="auth-card">
            <h2>{welcome ? 'Create your password' : 'New password'}</h2>
            {!token ? (
              <p className="muted">This link is incomplete. <Link to="/portal/forgot-password">Request a new one</Link>.</p>
            ) : (
              <form className="p-form" onSubmit={submit} noValidate>
                <ErrorBox error={error} />
                <Field label="New password" error={errors.password} hint="At least 8 characters, with a letter and a number." required>
                  <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus required />
                </Field>
                <Field label="Confirm new password" error={errors.confirm} required>
                  <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
                </Field>
                <Button type="submit" block disabled={busy || !password}>{busy ? 'Saving…' : 'Save password'}</Button>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
