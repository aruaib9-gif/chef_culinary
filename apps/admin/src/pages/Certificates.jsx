import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../lib/useApi.js'
import { api, fetchFile } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { date } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Badge, SearchInput, CohortSelect, Modal, Field, Checkbox, Notice, useAction } from '../components/ui.jsx'
import { StudentPicker } from './StudentFinance.jsx'

// Certificates with serial, verification code and QR; public verification page on the website (spec §9.3).
export default function Certificates() {
  const { isSuper } = useAuth()
  const [f, setF] = useState({ q: '', cohortId: '' })
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString()
  const { data, error, loading, reload } = useApi(`/admin/certificates?${qs}`)
  const [modal, setModal] = useState(null)
  const action = useAction()

  async function revoke(c) {
    const reason = window.prompt(`Revoke certificate ${c.serial}? It will show as revoked on the verification page. Reason:`)
    if (reason && (await action.run(() => api(`/admin/certificates/${c.id}/revoke`, { method: 'POST', body: { reason } })))) reload()
  }

  return (
    <>
      <PageHeader
        title="Certificates"
        intro="Graduates and employers verify certificates at /verify on the website using the serial or verification code."
        actions={isSuper && <><button type="button" className="a-btn a-btn--ghost" onClick={() => setModal('bulk')}>Issue to a cohort</button><button type="button" className="a-btn" onClick={() => setModal('one')}>Issue certificate</button></>}
      />
      <div className="a-filters">
        <SearchInput value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="Name, student ID or serial" />
        <CohortSelect value={f.cohortId} onChange={(cohortId) => setF({ ...f, cohortId })} />
      </div>
      <ErrorBox error={error || action.error} onRetry={reload} />
      {action.ok === 'emailed' && <Notice tone="success">Certificate emailed.</Notice>}
      {loading && !data ? <Loading /> : data && (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Serial</th><th>Student</th><th>Award</th><th>Grade</th><th>Issued</th><th>Code</th><th /></tr></thead>
            <tbody>
              {data.length === 0 && <tr><td colSpan={7} className="a-empty">No certificates issued yet.</td></tr>}
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="nowrap">{c.serial} {c.revoked_at && <Badge status="revoked" />}</td>
                  <td><Link to={`/students/${c.student_id}`}>{c.first_name} {c.last_name}</Link><div className="a-meta">{c.student_number} · {c.cohort_name ?? ''}</div></td>
                  <td>{c.title}</td>
                  <td>{c.grade ?? '—'}</td>
                  <td className="nowrap">{date(c.issued_on)}</td>
                  <td><code>{c.verification_code}</code></td>
                  <td className="nowrap">
                    <button type="button" className="a-link" onClick={() => fetchFile(`/admin/certificates/${c.id}/pdf`, { open: true })}>PDF</button>
                    {!c.revoked_at && <> · <button type="button" className="a-link" onClick={() => action.run(() => api(`/admin/certificates/${c.id}/email`, { method: 'POST' }), 'emailed')}>Email</button></>}
                    {!c.revoked_at && isSuper && <> · <button type="button" className="a-link" onClick={() => revoke(c)}>Revoke</button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal === 'one' && <IssueModal onClose={() => setModal(null)} onSaved={() => { setModal(null); reload() }} />}
      {modal === 'bulk' && <BulkModal onClose={() => setModal(null)} onSaved={() => { setModal(null); reload() }} />}
    </>
  )
}

function IssueModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ studentId: '', title: '', grade: '', issuedOn: new Date().toISOString().slice(0, 10) })
  const action = useAction()
  return (
    <Modal title="Issue certificate" onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <StudentPicker value={form.studentId} onChange={(v) => setForm({ ...form, studentId: v })} error={action.errors.studentId} />
        <Field label="Award title" hint="Blank = the programme’s ‘certificate awarded’ or its name."><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <div className="a-form__row">
          <Field label="Grade" hint="Blank = calculated from published results."><input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} /></Field>
          <Field label="Issue date"><input type="date" value={form.issuedOn} onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} /></Field>
        </div>
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={!form.studentId || action.busy} onClick={async () => { if (await action.run(() => api('/admin/certificates', { method: 'POST', body: form }))) onSaved() }}>Issue</button>
        </div>
      </div>
    </Modal>
  )
}

function BulkModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ cohortId: '', issuedOn: new Date().toISOString().slice(0, 10), markGraduated: true })
  const action = useAction()
  return (
    <Modal title="Issue certificates to a cohort" onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <Field label="Cohort" required><CohortSelect value={form.cohortId} onChange={(v) => setForm({ ...form, cohortId: v })} allowEmpty="Select…" className="" /></Field>
        <Field label="Issue date"><input type="date" value={form.issuedOn} onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} /></Field>
        <Checkbox label="Mark these students as graduated" checked={form.markGraduated} onChange={(v) => setForm({ ...form, markGraduated: v })} />
        <Notice>Every active or graduated student in the cohort without a certificate for it receives one. Grades come from their published results.</Notice>
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={!form.cohortId || action.busy} onClick={async () => { const r = await action.run(() => api('/admin/certificates/bulk', { method: 'POST', body: form })); if (r) { window.alert(`${r.issued} certificate(s) issued.`); onSaved() } }}>Issue certificates</button>
        </div>
      </div>
    </Modal>
  )
}
