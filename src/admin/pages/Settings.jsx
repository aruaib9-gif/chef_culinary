'use client'
import { useState } from 'react'
import { useSearchParams } from '@/lib/router'
import { useApi } from '../lib/useApi.js'
import { api, fetchFile } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { dateTime, humanize } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Badge, Pagination, SearchInput, Modal, Field, Checkbox, Notice, Tabs, useAction } from '../components/ui.jsx'

// Settings (spec §9.5), staff accounts and roles (§9.1), audit trail (§9.6, §12).
export default function Settings() {
  const { isSuper } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? (isSuper ? 'site' : 'account')
  const tabs = [['account', 'My account']]
  if (isSuper) tabs.unshift(['site', 'Website & contact'], ['policies', 'Policies'], ['users', 'Staff users'], ['audit', 'Audit log'])
  return (
    <>
      <PageHeader title="Settings & users" />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      {tab === 'account' && <MyAccount />}
      {tab === 'site' && isSuper && <SiteSettings />}
      {tab === 'policies' && isSuper && <Policies />}
      {tab === 'users' && isSuper && <Users />}
      {tab === 'audit' && isSuper && <AuditLog />}
    </>
  )
}

function useSettings() {
  return useApi('/admin/settings')
}

function SiteSettings() {
  const { data, error, loading, reload } = useSettings()
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <div className="a-grid2">
      <SiteForm initial={data.site} />
      <SocialForm initial={data.social} />
    </div>
  )
}

function SiteForm({ initial }) {
  const [form, setForm] = useState({ ...initial, emails: initial.emails.join(', ') })
  const action = useAction()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const save = () => action.run(() => api('/admin/settings/site', { method: 'PUT', body: { ...form, emails: form.emails.split(',').map((s) => s.trim()).filter(Boolean) } }), 'saved')
  return (
    <section className="panel a-form">
      <h2 className="a-section-title" style={{ margin: 0 }}>Academy details</h2>
      <p className="a-meta">Used on receipts, result slips, certificates, admission letters and emails.</p>
      {action.ok && <Notice tone="success">Saved.</Notice>}
      <ErrorBox error={action.error} />
      <Field label="Name" error={action.errors.name}><input value={form.name} onChange={set('name')} /></Field>
      <Field label="Legal name" error={action.errors.legalName}><input value={form.legalName} onChange={set('legalName')} /></Field>
      <Field label="Address" error={action.errors.address}><input value={form.address} onChange={set('address')} /></Field>
      <div className="a-form__row">
        <Field label="Phone" error={action.errors.phone}><input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="WhatsApp number" error={action.errors.whatsappNumber} hint="With country code, digits only"><input value={form.whatsappNumber} onChange={set('whatsappNumber')} /></Field>
      </div>
      <Field label="Emails (comma-separated)" error={action.errors.emails}><input value={form.emails} onChange={set('emails')} /></Field>
      <Field label="WhatsApp pre-filled message"><input value={form.whatsappMessage} onChange={set('whatsappMessage')} /></Field>
      <div className="a-form__foot"><button type="button" className="a-btn" disabled={action.busy} onClick={save}>Save</button></div>
    </section>
  )
}

function SocialForm({ initial }) {
  const [form, setForm] = useState(initial)
  const action = useAction()
  return (
    <section className="panel a-form">
      <h2 className="a-section-title" style={{ margin: 0 }}>Social media links</h2>
      {action.ok && <Notice tone="success">Saved.</Notice>}
      <ErrorBox error={action.error} />
      {['facebook', 'instagram', 'youtube', 'tiktok', 'x', 'linkedin'].map((k) => (
        <Field key={k} label={k === 'x' ? 'X (Twitter)' : humanize(k)} error={action.errors[k]}><input type="url" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder="https://" /></Field>
      ))}
      <div className="a-form__foot"><button type="button" className="a-btn" disabled={action.busy} onClick={() => action.run(() => api('/admin/settings/social', { method: 'PUT', body: form }), 'saved')}>Save</button></div>
    </section>
  )
}

function Policies() {
  const { data, error, loading, reload } = useSettings()
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <div className="a-grid2">
      <PolicyForm title="Results" settingKey="results" initial={data.results} render={(f, set) => (
        <>
          <Checkbox label="Withhold results from students who owe fees" hint="Published results stay hidden in the portal until the balance is cleared." checked={f.withholdIfOwing} onChange={(v) => set({ withholdIfOwing: v })} />
          <Checkbox label="Show position in class on result sheets" checked={f.showPositions} onChange={(v) => set({ showPositions: v })} />
        </>
      )} />
      <PolicyForm title="Attendance" settingKey="attendance" initial={data.attendance} render={(f, set) => (
        <Field label="Low-attendance threshold (%)"><input type="number" min="1" max="100" value={f.lowAttendanceThreshold} onChange={(e) => set({ lowAttendanceThreshold: Number(e.target.value) })} /></Field>
      )} />
      <PolicyForm title="Security" settingKey="security" initial={data.security} render={(f, set) => (
        <Checkbox label="Require two-step verification (emailed code) for all staff sign-ins" checked={f.requireAdminTwoFactor} onChange={(v) => set({ requireAdminTwoFactor: v })} />
      )} />
    </div>
  )
}

function PolicyForm({ title, settingKey, initial, render }) {
  const [form, setForm] = useState(initial)
  const action = useAction()
  return (
    <section className="panel a-form">
      <h2 className="a-section-title" style={{ margin: 0 }}>{title}</h2>
      {action.ok && <Notice tone="success">Saved.</Notice>}
      <ErrorBox error={action.error} />
      {render(form, (patch) => setForm({ ...form, ...patch }))}
      <div className="a-form__foot"><button type="button" className="a-btn" disabled={action.busy} onClick={() => action.run(() => api(`/admin/settings/${settingKey}`, { method: 'PUT', body: form }), 'saved')}>Save</button></div>
    </section>
  )
}

function Users() {
  const { user: me } = useAuth()
  const { data, error, loading, reload } = useApi('/admin/users')
  const [adding, setAdding] = useState(false)
  const [link, setLink] = useState(null)
  const action = useAction()
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const patch = async (u, body) => { if (await action.run(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body }))) reload() }
  return (
    <>
      <div className="a-row" style={{ marginBottom: 'var(--space-3)' }}><button type="button" className="a-btn" onClick={() => setAdding(true)}>Add staff user</button></div>
      <RoleGuide users={data} />
      {link && <Notice tone="warn">Email isn’t configured, so share this one-time set-password link with the new user directly: <code style={{ wordBreak: 'break-all' }}>{link}</code></Notice>}
      <ErrorBox error={action.error} />
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>2-step</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id}>
                <td className="nowrap"><strong>{u.full_name}</strong>{u.id === me.id && <span className="a-meta"> (you)</span>}</td>
                <td>{u.email}</td>
                <td className="nowrap">
                  {u.id === me.id ? (
                    <span className={`role-pill role-pill--${u.role}`} title="You can’t change your own role">{u.role === 'super_admin' ? 'Super admin' : 'Staff'}</span>
                  ) : (
                    <select className="a-input" style={{ minWidth: 150 }} value={u.role} onChange={(e) => patch(u, { role: e.target.value })} aria-label={`Role for ${u.full_name}`}>
                      <option value="super_admin">Super admin</option><option value="staff">Staff</option>
                    </select>
                  )}
                </td>
                <td>{u.two_factor_enabled ? 'On' : 'Off'}</td>
                <td className="nowrap">{dateTime(u.last_login_at)}</td>
                <td>{u.is_active ? <Badge status="active" /> : <Badge status="cancelled">Disabled</Badge>}{u.locked_until && new Date(u.locked_until) > new Date() && <> <Badge status="failed">Locked</Badge></>}</td>
                <td className="nowrap">
                  {u.id !== me.id && <button type="button" className="a-link" onClick={() => patch(u, { isActive: !u.is_active })}>{u.is_active ? 'Disable' : 'Enable'}</button>}
                  {u.locked_until && <> · <button type="button" className="a-link" onClick={async () => { await action.run(() => api(`/admin/users/${u.id}/unlock`, { method: 'POST' })); reload() }}>Unlock</button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <AddUser onClose={() => setAdding(false)} onSaved={(r) => { setAdding(false); setLink(r.setupLink ?? null); reload() }} />}
    </>
  )
}

// What each role can do — mirrors the permission checks in the API.
const ROLE_GUIDE = [
  {
    role: 'super_admin',
    label: 'Super admin',
    summary: 'Full control of the academy’s system.',
    can: [
      'Everything staff can do',
      'Payments, fees, refunds and financial reports',
      'Publish results and edit grading schemes',
      'Issue and revoke certificates',
      'Send bulk email to leads, students and alumni',
      'Website settings, staff accounts and the audit log',
      'Permanently delete records',
    ],
  },
  {
    role: 'staff',
    label: 'Staff',
    summary: 'Day-to-day academic and admissions work.',
    can: [
      'Leads, applications, admissions and enrolment',
      'Students, cohorts and timetables',
      'Enter and correct scores (as drafts)',
      'Attendance, materials and assignments',
      'Announcements, requests and feedback',
      'Reports (except finance)',
    ],
    cannot: ['Finance', 'Publishing results', 'Issuing certificates', 'Bulk email', 'Settings and staff accounts'],
  },
]

function RoleGuide({ users }) {
  const count = (role) => users.filter((u) => u.role === role && u.is_active).length
  return (
    <section className="role-guide" aria-label="What each role can do">
      {ROLE_GUIDE.map((r) => (
        <article key={r.role} className="role-card">
          <header className="role-card__head">
            <span className={`role-pill role-pill--${r.role}`}>{r.label}</span>
            <span className="a-meta">{count(r.role)} active</span>
          </header>
          <p className="role-card__summary">{r.summary}</p>
          <ul className="role-card__list">
            {r.can.map((item) => (
              <li key={item}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                {item}
              </li>
            ))}
          </ul>
          {r.cannot && (
            <div className="role-card__cannot">
              <span className="role-card__cannot-label">Super admin only</span>
              <ul>{r.cannot.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
        </article>
      ))}
    </section>
  )
}

function AddUser({ onClose, onSaved }) {
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', role: 'staff' })
  const action = useAction()
  return (
    <Modal title="Add staff user" onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <Field label="Full name" required error={action.errors.fullName}><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
        <Field label="Email" required error={action.errors.email}><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <div className="a-form__row">
          <Field label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Role"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="staff">Staff</option><option value="super_admin">Super admin</option></select></Field>
        </div>
        <Notice>They’ll receive an email with a link to set their password (valid 7 days).</Notice>
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy} onClick={async () => { const r = await action.run(() => api('/admin/users', { method: 'POST', body: form })); if (r) onSaved(r) }}>Create user</button>
        </div>
      </div>
    </Modal>
  )
}

function AuditLog() {
  const [f, setF] = useState({ page: 1, q: '', action: '' })
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString()
  const { data, error, loading, reload } = useApi(`/admin/audit-log?${qs}`)
  return (
    <>
      <div className="a-filters">
        <SearchInput value={f.q} onChange={(q) => setF({ ...f, q, page: 1 })} placeholder="Search details or user" />
        <select className="a-input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value, page: 1 })}>
          <option value="">All actions</option>
          {['auth', 'application', 'student', 'results', 'payment', 'invoice', 'certificate', 'settings', 'user', 'lead', 'programme', 'cohort', 'attendance', 'messaging'].map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
        </select>
        <button type="button" className="a-btn a-btn--ghost" onClick={() => fetchFile(`/admin/audit-log.csv?${qs}`)}>Export CSV</button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Details</th><th>IP</th></tr></thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{dateTime(a.created_at)}</td>
                    <td>{a.user_name ?? '—'}</td>
                    <td><code>{a.action}</code></td>
                    <td>{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
                    <td className="a-meta" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{a.details ? JSON.stringify(a.details).slice(0, 200) : ''}</td>
                    <td className="a-meta">{a.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setF({ ...f, page })} />
        </>
      )}
    </>
  )
}

function MyAccount() {
  const { user, refresh } = useAuth()
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [twoFa, setTwoFa] = useState('')
  const pwAction = useAction()
  const faAction = useAction()
  return (
    <div className="a-grid2">
      <section className="panel a-form">
        <h2 className="a-section-title" style={{ margin: 0 }}>Change password</h2>
        {pwAction.ok && <Notice tone="success">Password changed. Your other sessions were signed out.</Notice>}
        <ErrorBox error={pwAction.error} />
        <Field label="Current password" error={pwAction.errors.currentPassword}><input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="New password" error={pwAction.errors.newPassword} hint="At least 8 characters, with a letter and a number."><input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="Confirm new password" error={pw.confirm && pw.confirm !== pw.newPassword ? 'Does not match' : undefined}><input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" /></Field>
        <div className="a-form__foot">
          <button type="button" className="a-btn" disabled={pwAction.busy || !pw.newPassword || pw.confirm !== pw.newPassword} onClick={async () => {
            if (await pwAction.run(() => api('/auth/change-password', { method: 'POST', body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } }))) { setPw({ currentPassword: '', newPassword: '', confirm: '' }); refresh() }
          }}>Update password</button>
        </div>
      </section>
      <section className="panel a-form">
        <h2 className="a-section-title" style={{ margin: 0 }}>Two-step verification · {user.twoFactorEnabled ? 'On' : 'Off'}</h2>
        <p className="muted">When on, a 6-digit code is emailed to {user.email} each time you sign in.</p>
        {faAction.ok && <Notice tone="success">Updated.</Notice>}
        <ErrorBox error={faAction.error} />
        <Field label="Confirm with your password"><input type="password" value={twoFa} onChange={(e) => setTwoFa(e.target.value)} autoComplete="current-password" /></Field>
        <div className="a-form__foot">
          <button type="button" className="a-btn" disabled={faAction.busy || !twoFa} onClick={async () => { if (await faAction.run(() => api('/auth/two-factor', { method: 'POST', body: { enabled: !user.twoFactorEnabled, password: twoFa } }))) { setTwoFa(''); refresh() } }}>{user.twoFactorEnabled ? 'Turn off' : 'Turn on'}</button>
        </div>
      </section>
    </div>
  )
}
