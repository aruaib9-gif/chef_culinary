import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import Button from '../../components/ui/Button.jsx'
import PasswordInput from '../../components/portal/PasswordInput.jsx'
import { Field, ErrorBox } from '../../components/portal/ui.jsx'

// Applicant account creation. Enrolled students get their accounts from the academy.
export default function Signup() {
  const { user, signup } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const next = location.state?.from || '/admissions/apply'
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirm: '', consent: false, website: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={next} replace />
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  async function submit(e) {
    e.preventDefault()
    setError(null)
    const local = {}
    if (form.password !== form.confirm) local.confirm = 'Passwords do not match'
    if (!form.consent) local.consent = 'Please accept to continue'
    setErrors(local)
    if (Object.keys(local).length) return
    setBusy(true)
    try {
      const { confirm, ...body } = form // eslint-disable-line no-unused-vars
      await signup(body)
      navigate(next, { replace: true })
    } catch (err) {
      setErrors(err.details ?? {})
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader eyebrow="Admissions" title="Create your account" intro="Your account lets you apply online, save your progress and track your application." />
      <section className="section">
        <div className="container auth-wrap">
          <div className="auth-card">
            <h2>Applicant sign-up</h2>
            <p className="muted">Already a student? <Link to="/portal/login">Sign in</Link> with your student ID.</p>
            <form className="p-form" onSubmit={submit} noValidate>
              <ErrorBox error={error} />
              <Field label="Full name" error={errors.fullName} required>
                <input value={form.fullName} onChange={set('fullName')} autoComplete="name" required />
              </Field>
              <Field label="Email" error={errors.email} required>
                <input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
              </Field>
              <Field label="Phone number" error={errors.phone} required>
                <input type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" placeholder="080..." required />
              </Field>
              <Field label="Password" error={errors.password} hint="At least 8 characters, with a letter and a number." required>
                <PasswordInput value={form.password} onChange={set('password')} autoComplete="new-password" required />
              </Field>
              <Field label="Confirm password" error={errors.confirm} required>
                <PasswordInput value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
              </Field>
              {/* Honeypot: hidden from people, filled by bots. */}
              <input type="text" name="website" value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }} />
              <label className="consent">
                <input type="checkbox" checked={form.consent} onChange={set('consent')} />
                <span>I agree to the academy storing and using my details to process my application, as described in the <Link to="/legal/privacy">privacy policy</Link>.</span>
              </label>
              {errors.consent && <span className="p-field__error">{errors.consent}</span>}
              <Button type="submit" block disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</Button>
            </form>
          </div>
        </div>
      </section>
    </>
  )
}
