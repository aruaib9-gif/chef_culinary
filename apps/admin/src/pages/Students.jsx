import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApi } from '../lib/useApi.js'
import { api, fetchFile, fetchImageUrl } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { money, date, dateTime, humanize } from '../lib/format.js'
import {
  PageHeader, Loading, ErrorBox, Badge, Pagination, SearchInput, ProgrammeSelect, CohortSelect, Modal, Field, Checkbox, Notice, Tabs, Stat, useAction,
} from '../components/ui.jsx'
import StudentFinance from './StudentFinance.jsx'

const STATUSES = ['active', 'suspended', 'graduated', 'withdrawn', 'archived']

// Student records: add, edit, archive, bulk import (spec §9.3).
export default function Students() {
  const [f, setF] = useState({ page: 1, q: '', status: '', programmeId: '', cohortId: '' })
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString()
  const { data, error, loading, reload } = useApi(`/admin/students?${qs}`)
  const [modal, setModal] = useState(null)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }))

  return (
    <>
      <PageHeader
        title="Students"
        actions={
          <>
            <button type="button" className="a-btn a-btn--ghost" onClick={() => fetchFile(`/admin/students/export.csv?${qs}`)}>Export CSV</button>
            <button type="button" className="a-btn a-btn--ghost" onClick={() => setModal('import')}>Import CSV</button>
            <button type="button" className="a-btn" onClick={() => setModal('add')}>Add student</button>
          </>
        }
      />
      <div className="a-filters">
        <SearchInput value={f.q} onChange={set('q')} placeholder="Name, ID, email, phone" />
        <ProgrammeSelect value={f.programmeId} onChange={(v) => setF((x) => ({ ...x, programmeId: v, cohortId: '', page: 1 }))} />
        <CohortSelect value={f.cohortId} onChange={set('cohortId')} programmeId={f.programmeId} />
        <select className="a-input" value={f.status} onChange={(e) => set('status')(e.target.value)}>
          <option value="">Current (not archived)</option>
          {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>Student ID</th><th>Name</th><th>Programme / cohort</th><th>Contact</th><th>Status</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {data.items.length === 0 && <tr><td colSpan={6} className="a-empty">No students found.</td></tr>}
                {data.items.map((s) => (
                  <tr key={s.id}>
                    <td className="nowrap"><Link to={`/students/${s.id}`}>{s.student_number}</Link></td>
                    <td>{s.first_name} {s.last_name}</td>
                    <td>{s.programme_name ?? '—'}<div className="a-meta">{s.cohort_name ?? 'No cohort'}</div></td>
                    <td>{s.email ?? '—'}<div className="a-meta">{s.phone ?? ''}</div></td>
                    <td><Badge status={s.status} /></td>
                    <td className="num">{s.balance_kobo > 0 ? <Badge status="overdue">{money(s.balance_kobo)}</Badge> : money(s.balance_kobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={set('page')} />
        </>
      )}
      {modal === 'add' && <StudentForm onClose={() => setModal(null)} onSaved={() => { setModal(null); reload() }} />}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
    </>
  )
}

const blank = { firstName: '', lastName: '', email: '', phone: '', gender: '', dateOfBirth: '', address: '', city: '', state: '', guardianName: '', guardianPhone: '', guardianRelationship: '', sponsor: '', programmeId: '', cohortId: '', notes: '' }

function toForm(s) {
  return {
    firstName: s.first_name, lastName: s.last_name, email: s.email ?? '', phone: s.phone ?? '', gender: s.gender ?? '', dateOfBirth: s.date_of_birth ?? '',
    address: s.address ?? '', city: s.city ?? '', state: s.state ?? '', guardianName: s.guardian_name ?? '', guardianPhone: s.guardian_phone ?? '',
    guardianRelationship: s.guardian_relationship ?? '', sponsor: s.sponsor ?? '', programmeId: s.programme_id ?? '', cohortId: s.cohort_id ?? '', notes: s.notes ?? '',
    status: s.status,
  }
}

function StudentFields({ form, setForm, errors, isNew }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <>
      <div className="a-form__row">
        <Field label="First name" required error={errors.firstName}><input value={form.firstName} onChange={set('firstName')} /></Field>
        <Field label="Last name" required error={errors.lastName}><input value={form.lastName} onChange={set('lastName')} /></Field>
      </div>
      <div className="a-form__row">
        <Field label="Email" error={errors.email} hint={isNew ? 'Needed for portal access.' : undefined}><input type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Phone" error={errors.phone}><input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Gender"><select value={form.gender} onChange={set('gender')}><option value="">—</option><option>Female</option><option>Male</option><option>Other</option></select></Field>
        <Field label="Date of birth" error={errors.dateOfBirth}><input type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} /></Field>
      </div>
      <div className="a-form__row">
        <Field label="Programme"><ProgrammeSelect value={form.programmeId} onChange={(v) => setForm({ ...form, programmeId: v, cohortId: '' })} allowEmpty="—" className="" /></Field>
        <Field label="Cohort" error={errors.cohortId}><CohortSelect value={form.cohortId} onChange={(v) => setForm({ ...form, cohortId: v })} programmeId={form.programmeId} allowEmpty="—" className="" /></Field>
        {!isNew && (
          <Field label="Status"><select value={form.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>
        )}
      </div>
      <div className="a-form__row">
        <Field label="Address"><input value={form.address} onChange={set('address')} /></Field>
        <Field label="City"><input value={form.city} onChange={set('city')} /></Field>
        <Field label="State"><input value={form.state} onChange={set('state')} /></Field>
      </div>
      <div className="a-form__row">
        <Field label="Guardian name"><input value={form.guardianName} onChange={set('guardianName')} /></Field>
        <Field label="Guardian phone"><input value={form.guardianPhone} onChange={set('guardianPhone')} /></Field>
        <Field label="Relationship"><input value={form.guardianRelationship} onChange={set('guardianRelationship')} /></Field>
        <Field label="Sponsor"><input value={form.sponsor} onChange={set('sponsor')} /></Field>
      </div>
      <Field label="Internal notes"><textarea value={form.notes} onChange={set('notes')} /></Field>
    </>
  )
}

function StudentForm({ onClose, onSaved }) {
  const [form, setForm] = useState({ ...blank, createAccount: true, raiseCharges: true })
  const action = useAction()
  const navigate = useNavigate()
  async function save() {
    const s = await action.run(() => api('/admin/students', { method: 'POST', body: form }))
    if (s) { onSaved(); navigate(`/students/${s.id}`) }
  }
  return (
    <Modal title="Add student" onClose={onClose} wide>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <StudentFields form={form} setForm={setForm} errors={action.errors} isNew />
        <Checkbox label="Create a portal account and email a set-password link" checked={form.createAccount} onChange={(v) => setForm({ ...form, createAccount: v })} />
        <Checkbox label="Raise tuition charges from the programme’s fee plan" checked={form.raiseCharges} onChange={(v) => setForm({ ...form, raiseCharges: v })} />
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy} onClick={save}>Add student</button>
        </div>
      </div>
    </Modal>
  )
}

function ImportModal({ onClose, onDone }) {
  const [file, setFile] = useState(null)
  const [accounts, setAccounts] = useState(true)
  const [preview, setPreview] = useState(null)
  const action = useAction()
  async function send(dryRun) {
    const form = new FormData()
    form.append('file', file)
    const r = await action.run(() => api(`/admin/students/import?dryRun=${dryRun ? 1 : 0}&accounts=${accounts ? 1 : 0}`, { method: 'POST', form }))
    if (!r) return
    setPreview(r)
    if (!r.dryRun && r.imported) setTimeout(onDone, 1200)
  }
  return (
    <Modal title="Import students from CSV" onClose={onClose} wide>
      <div className="a-form">
        <p className="muted">Save your Excel sheet as CSV. Columns: first_name, last_name, email, phone, gender, date_of_birth (YYYY-MM-DD), programme (slug or name), cohort (name), guardian_name, guardian_phone, student_number (optional — generated if blank).</p>
        <div><button type="button" className="a-link" onClick={() => fetchFile('/admin/students/import-template.csv')}>Download template</button></div>
        <ErrorBox error={action.error} />
        <Field label="CSV file"><input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files[0] ?? null); setPreview(null) }} /></Field>
        <Checkbox label="Create portal accounts and email set-password links (rows with an email)" checked={accounts} onChange={setAccounts} />
        {preview && (
          preview.dryRun ? (
            <Notice tone={preview.errors.length ? 'warn' : 'success'}>
              {preview.valid} of {preview.total} rows are ready to import{preview.errors.length ? `; ${preview.errors.length} need fixing. Nothing has been imported.` : '.'}
            </Notice>
          ) : <Notice tone="success">Imported {preview.imported} students.</Notice>
        )}
        {preview?.errors?.length > 0 && (
          <div className="a-table-wrap" style={{ maxHeight: 240 }}>
            <table className="a-table"><thead><tr><th>Line</th><th>Problem</th></tr></thead>
              <tbody>{preview.errors.map((e) => <tr key={`${e.line}-${e.error}`}><td>{e.line}</td><td>{e.error}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Close</button>
          <button type="button" className="a-btn a-btn--ghost" disabled={!file || action.busy} onClick={() => send(true)}>Check file</button>
          <button type="button" className="a-btn" disabled={!file || action.busy || !preview?.dryRun || preview.errors.length > 0} onClick={() => send(false)}>Import</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Student profile ──────────────────────────────────────────────────────────

export function StudentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isSuper } = useAuth()
  const { data: s, error, loading, reload } = useApi(`/admin/students/${id}`)
  const [tab, setTab] = useState('profile')
  const [photo, setPhoto] = useState(null)
  const [temp, setTemp] = useState(null)
  const action = useAction()

  useEffect(() => {
    let url
    if (s?.photo_file_id) fetchImageUrl(`/admin/students/${id}/photo`).then((u) => { url = u; setPhoto(u) })
    return () => url && URL.revokeObjectURL(url)
  }, [s?.photo_file_id, id])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  async function uploadPhoto(file) {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    if (await action.run(() => api(`/admin/students/${id}/photo`, { method: 'POST', form }))) reload()
  }

  const tabs = [['profile', 'Profile'], ['records', 'Results & records'], ['account', 'Portal account']]
  if (isSuper) tabs.splice(1, 0, ['fees', 'Fees & payments'])

  return (
    <>
      <PageHeader
        title={`${s.first_name} ${s.last_name}`}
        intro={<>{s.student_number} · {s.programme_name ?? 'No programme'} · {s.cohort_name ?? 'No cohort'} · <Badge status={s.status} /></>}
        actions={
          <>
            <button type="button" className="a-btn a-btn--ghost" onClick={() => navigate('/students')}>Back</button>
            <button type="button" className="a-btn a-btn--ghost" onClick={() => fetchFile(`/admin/students/${id}/id-card.pdf`, { open: true })}>ID card</button>
          </>
        }
      />
      <div className="kpis" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="panel a-row">
          {photo ? <img src={photo} alt="" style={{ width: 64, height: 76, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} /> : <span className="a-meta">No photo</span>}
          <label className="a-btn a-btn--ghost a-btn--sm">Upload photo<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => uploadPhoto(e.target.files[0])} /></label>
        </div>
        <Stat label="Balance" value={money(Math.max(0, s.account.balanceKobo))} tone={s.account.balanceKobo > 0 ? 'warn' : undefined} sub={`Paid ${money(s.account.paidKobo)}`} />
        <Stat label="Attendance" value={s.attendance.total ? `${Math.round((s.attendance.attended / s.attendance.total) * 100)}%` : '—'} sub={`${s.attendance.attended}/${s.attendance.total} sessions`} />
        <Stat label="Enrolled" value={date(s.enrolled_on)} sub={s.graduated_on ? `Graduated ${date(s.graduated_on)}` : null} />
      </div>
      <ErrorBox error={action.error} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'profile' && <ProfileTab s={s} onSaved={reload} />}
      {tab === 'fees' && <StudentFinance studentId={s.id} onChange={reload} />}
      {tab === 'records' && <RecordsTab s={s} />}
      {tab === 'account' && (
        <div className="panel a-stack">
          {s.user_id ? (
            <>
              <dl className="a-dl">
                <div><dt>Sign-in email</dt><dd>{s.login_email}</dd></div>
                <div><dt>Last sign-in</dt><dd>{dateTime(s.last_login_at)}</dd></div>
                <div><dt>Status</dt><dd>{s.account_active ? 'Active' : 'Disabled'}{s.locked_until && new Date(s.locked_until) > new Date() ? ' · Locked' : ''}</dd></div>
                <div><dt>Two-step verification</dt><dd>{s.two_factor_enabled ? 'On' : 'Off'}</dd></div>
              </dl>
              {temp && <Notice tone="success">Temporary password: <strong style={{ fontFamily: 'monospace', fontSize: 'var(--text-lg)' }}>{temp}</strong> — give this to the student. They must change it after signing in.</Notice>}
              <div className="a-row">
                <button type="button" className="a-btn a-btn--ghost" disabled={action.busy} onClick={async () => { const r = await action.run(() => api(`/admin/students/${id}/reset-password`, { method: 'POST' })); if (r) setTemp(r.temporaryPassword) }}>Reset password / unlock</button>
                <button type="button" className="a-btn a-btn--ghost" disabled={action.busy} onClick={async () => { if (await action.run(() => api(`/admin/students/${id}/account-status`, { method: 'POST', body: { active: !s.account_active } }))) reload() }}>
                  {s.account_active ? 'Disable portal access' : 'Enable portal access'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted">This student has no portal account.</p>
              <div><button type="button" className="a-btn" disabled={action.busy || !s.email} onClick={async () => { if (await action.run(() => api(`/admin/students/${id}/account`, { method: 'POST' }), 'sent')) reload() }}>Create account & email set-password link</button></div>
              {!s.email && <p className="a-meta">Add an email on the Profile tab first.</p>}
            </>
          )}
          {isSuper && (
            <div style={{ borderTop: '1px solid var(--color-line)', paddingTop: 'var(--space-4)' }}>
              <p className="a-meta">Permanent deletion is only for data-erasure requests (NDPA). Archive the student instead in normal cases.</p>
              <button type="button" className="a-btn a-btn--danger a-btn--sm" style={{ marginTop: 'var(--space-2)' }} onClick={async () => {
                if (window.prompt(`Type DELETE to permanently erase ${s.first_name} ${s.last_name} and all their records.`) !== 'DELETE') return
                if (await action.run(() => api(`/admin/students/${id}`, { method: 'DELETE' }))) navigate('/students')
              }}>Delete permanently</button>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function ProfileTab({ s, onSaved }) {
  const [form, setForm] = useState(() => toForm(s))
  const action = useAction()
  return (
    <div className="panel a-form">
      {action.ok && <Notice tone="success">Saved.</Notice>}
      <ErrorBox error={action.error} />
      <StudentFields form={form} setForm={setForm} errors={action.errors} />
      <div className="a-form__foot">
        <button type="button" className="a-btn" disabled={action.busy} onClick={async () => { if (await action.run(() => api(`/admin/students/${s.id}`, { method: 'PATCH', body: form }))) onSaved() }}>Save changes</button>
      </div>
    </div>
  )
}

function RecordsTab({ s }) {
  const cohorts = [...new Map(s.results.map((r) => [r.cohort_id, r.cohort_name])).entries()]
  return (
    <div className="a-stack">
      <section>
        <div className="a-row" style={{ justifyContent: 'space-between' }}>
          <h3 className="a-section-title">Results</h3>
          <div className="a-row">{cohorts.map(([cid, name]) => <button key={cid} type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => fetchFile(`/admin/results/students/${s.id}/slip.pdf?cohortId=${cid}`, { open: true })}>Result slip · {name}</button>)}</div>
        </div>
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Cohort</th><th>Course</th><th className="num">Total</th><th>Grade</th><th>Status</th></tr></thead>
            <tbody>
              {s.results.length === 0 && <tr><td colSpan={5} className="a-empty">No results recorded.</td></tr>}
              {s.results.map((r) => <tr key={r.id}><td>{r.cohort_name}</td><td>{r.course_name}</td><td className="num">{r.total}</td><td>{r.grade}</td><td><Badge status={r.status} /></td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3 className="a-section-title">Certificates</h3>
        {s.certificates.length === 0 ? <p className="muted">None issued. <Link to="/certificates">Issue a certificate</Link></p> : (
          <ul>{s.certificates.map((c) => <li key={c.id}>{c.title} · {c.serial} · {date(c.issued_on)} {c.revoked_at && <Badge status="revoked" />}</li>)}</ul>
        )}
      </section>
      <section>
        <h3 className="a-section-title">Requests</h3>
        {s.requests.length === 0 ? <p className="muted">No requests.</p> : (
          <ul>{s.requests.map((r) => <li key={r.id}>{humanize(r.type)} · {date(r.created_at)} · <Badge status={r.status} /></li>)}</ul>
        )}
      </section>
    </div>
  )
}
