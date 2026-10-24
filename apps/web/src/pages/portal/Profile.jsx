import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useApi } from '../../lib/useApi.js'
import { api, fetchImageUrl } from '../../lib/api.js'
import { date } from '../../lib/format.js'
import { states, lgasFor } from '../../lib/nigeria.js'
import PasswordInput from '../../components/portal/PasswordInput.jsx'
import { PageHead, Loading, ErrorBox, Field, Notice } from '../../components/portal/ui.jsx'

// Profile with photo and contact details (spec §8.1), password change and two-step verification.
export default function Profile() {
  const { user } = useAuth()
  return (
    <div className="portal-page">
      <PageHead title={user.role === 'student' ? 'Profile' : 'Account'} intro="Keep your details up to date and your account secure." />
      {user.role === 'student' ? <StudentDetails /> : <AccountDetails />}
      <ChangePassword />
      <TwoFactor />
    </div>
  )
}

function StudentDetails() {
  const { data, error, loading, reload, setData } = useApi('/student/profile')
  const [form, setForm] = useState(null)
  const [state, setState] = useState({})
  const [photoUrl, setPhotoUrl] = useState(null)

  useEffect(() => {
    if (data && !form) setForm({ phone: data.phone ?? '', address: data.address ?? '', city: data.city ?? '', state: data.state ?? '', guardianName: data.guardianName ?? '', guardianPhone: data.guardianPhone ?? '', guardianRelationship: data.guardianRelationship ?? '' })
  }, [data, form])

  useEffect(() => {
    let url
    if (data?.hasPhoto) fetchImageUrl('/student/profile/photo').then((u) => { url = u; setPhotoUrl(u) })
    return () => url && URL.revokeObjectURL(url)
  }, [data?.hasPhoto])

  if (loading || !form) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setState({}) }

  async function save(e) {
    e.preventDefault()
    setState({ busy: true })
    try {
      setData(await api('/student/profile', { method: 'PATCH', body: form }))
      setState({ saved: true })
    } catch (err) {
      setState({ error: err })
    }
  }

  async function upload(file) {
    if (!file) return
    const f = new FormData()
    f.append('file', file)
    setState({ busy: true })
    try {
      await api('/student/profile/photo', { method: 'POST', form: f })
      setData((d) => ({ ...d, hasPhoto: true }))
      setPhotoUrl(await fetchImageUrl('/student/profile/photo'))
      setState({ photoSaved: true })
    } catch (err) {
      setState({ error: err })
    }
  }

  return (
    <>
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-5)', alignItems: 'center' }}>
        <div style={{ width: 96, height: 112, borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--color-surface-warm)', display: 'grid', placeItems: 'center', flex: 'none' }}>
          {photoUrl ? <img src={photoUrl} alt="Your profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="muted">No photo</span>}
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <strong style={{ fontSize: 'var(--text-lg)' }}>{data.firstName} {data.lastName}</strong>
          <span className="muted">Student ID {data.studentNumber}</span>
          <span className="muted">{data.programme ?? '—'}{data.cohort ? ` · ${data.cohort}` : ''}</span>
          <span className="muted">Email {data.email ?? '—'} · Enrolled {date(data.enrolledOn)}</span>
          <label className="p-btn" style={{ width: 'fit-content', marginTop: 'var(--space-2)' }}>
            {data.hasPhoto ? 'Change photo' : 'Upload photo'}
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files[0])} />
          </label>
        </div>
      </div>

      <div className="card">
        <h2 className="portal-card-title">Contact details</h2>
        <form className="p-form" onSubmit={save} style={{ marginTop: 'var(--space-3)' }}>
          {state.saved && <Notice tone="success">Profile saved.</Notice>}
          {state.photoSaved && <Notice tone="success">Photo updated.</Notice>}
          <ErrorBox error={state.error} />
          <div className="p-form__row">
            <Field label="Phone" error={state.error?.details?.phone}><input type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" /></Field>
            <Field label="Home address"><input value={form.address} onChange={set('address')} autoComplete="street-address" /></Field>
          </div>
          <div className="p-form__row">
            <Field label="State">
              <select value={form.state} onChange={(e) => { setForm({ ...form, state: e.target.value, city: '' }); setState({}) }}>
                <option value="">Select state…</option>
                {states.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="City / town">
              <select value={form.city} onChange={set('city')} disabled={!form.state}>
                <option value="">{form.state ? 'Select city / town…' : 'Select state first'}</option>
                {lgasFor(form.state).map((c) => <option key={c}>{c}</option>)}
                {form.city && !lgasFor(form.state).includes(form.city) && <option>{form.city}</option>}
              </select>
            </Field>
          </div>
          <h3 className="p-field__label" style={{ marginTop: 'var(--space-2)' }}>Parent / guardian / sponsor</h3>
          <div className="p-form__row">
            <Field label="Name"><input value={form.guardianName} onChange={set('guardianName')} /></Field>
            <Field label="Phone"><input type="tel" value={form.guardianPhone} onChange={set('guardianPhone')} /></Field>
            <Field label="Relationship"><input value={form.guardianRelationship} onChange={set('guardianRelationship')} /></Field>
          </div>
          <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>To change your name, date of birth, email or programme, <Link to="/portal/requests">submit a change of details request</Link>.</p>
          <div><button type="submit" className="p-btn p-btn--primary" disabled={state.busy}>Save changes</button></div>
        </form>
      </div>
    </>
  )
}

function AccountDetails() {
  const { user, refresh } = useAuth()
  const [form, setForm] = useState({ fullName: user.fullName, phone: user.phone ?? '' })
  const [state, setState] = useState({})

  async function save(e) {
    e.preventDefault()
    setState({ busy: true })
    try {
      await api('/auth/me', { method: 'PATCH', body: form })
      await refresh()
      setState({ saved: true })
    } catch (err) {
      setState({ error: err })
    }
  }

  return (
    <div className="card">
      <h2 className="portal-card-title">Your details</h2>
      <form className="p-form" onSubmit={save} style={{ marginTop: 'var(--space-3)' }}>
        {state.saved && <Notice tone="success">Saved.</Notice>}
        <ErrorBox error={state.error} />
        <div className="p-form__row">
          <Field label="Full name" error={state.error?.details?.fullName}><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <Field label="Phone" error={state.error?.details?.phone}><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        </div>
        <Field label="Email" hint="Contact the academy to change your sign-in email."><input value={user.email} disabled /></Field>
        <div><button type="submit" className="p-btn p-btn--primary" disabled={state.busy}>Save</button></div>
      </form>
    </div>
  )
}

function ChangePassword() {
  const { refresh } = useAuth()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [state, setState] = useState({})

  async function save(e) {
    e.preventDefault()
    if (form.newPassword !== form.confirm) return setState({ errors: { confirm: 'Passwords do not match' } })
    setState({ busy: true })
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } })
      setForm({ currentPassword: '', newPassword: '', confirm: '' })
      setState({ saved: true })
      refresh()
    } catch (err) {
      setState({ error: err, errors: err.details })
    }
  }

  const errors = state.errors ?? {}
  return (
    <div className="card" id="security">
      <h2 className="portal-card-title">Change password</h2>
      <form className="p-form" onSubmit={save} style={{ marginTop: 'var(--space-3)' }}>
        {state.saved && <Notice tone="success">Password changed. Other devices have been signed out.</Notice>}
        <ErrorBox error={state.error} />
        <Field label="Current password" error={errors.currentPassword}>
          <PasswordInput value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} autoComplete="current-password" />
        </Field>
        <div className="p-form__row">
          <Field label="New password" error={errors.newPassword} hint="At least 8 characters, with a letter and a number.">
            <PasswordInput value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" error={errors.confirm}>
            <PasswordInput value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" />
          </Field>
        </div>
        <div><button type="submit" className="p-btn p-btn--primary" disabled={state.busy || !form.currentPassword || !form.newPassword}>Update password</button></div>
      </form>
    </div>
  )
}

function TwoFactor() {
  const { user, refresh } = useAuth()
  const [password, setPassword] = useState('')
  const [state, setState] = useState({})
  const enabled = user.twoFactorEnabled

  async function toggle(e) {
    e.preventDefault()
    setState({ busy: true })
    try {
      await api('/auth/two-factor', { method: 'POST', body: { enabled: !enabled, password } })
      setPassword('')
      await refresh()
      setState({ saved: true })
    } catch (err) {
      setState({ error: err })
    }
  }

  return (
    <div className="card">
      <h2 className="portal-card-title">Two-step verification {enabled ? '· On' : '· Off'}</h2>
      <p className="muted" style={{ marginTop: 'var(--space-1)' }}>When on, we email you a 6-digit code each time you sign in.</p>
      <form className="p-form" onSubmit={toggle} style={{ marginTop: 'var(--space-3)' }}>
        {state.saved && <Notice tone="success">Two-step verification is now {enabled ? 'on' : 'off'}.</Notice>}
        <ErrorBox error={state.error} />
        <div className="p-form__row">
          <Field label="Confirm with your password"><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        </div>
        <div><button type="submit" className="p-btn" disabled={state.busy || !password}>{enabled ? 'Turn off' : 'Turn on'}</button></div>
      </form>
    </div>
  )
}
