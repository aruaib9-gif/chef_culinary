import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApi } from '../lib/useApi.js'
import { api, fetchFile, fetchImageUrl } from '../lib/api.js'
import { useLookups } from '../lib/auth.jsx'
import { date, dateTime, humanize, fileSize } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Badge, Pagination, SearchInput, ProgrammeSelect, CohortSelect, Modal, Field, Checkbox, Notice, Tabs, useAction } from '../components/ui.jsx'

const STATUS_TABS = [['', 'All submitted'], ['received', 'Received'], ['under_review', 'Under review'], ['admitted', 'Admitted'], ['waitlisted', 'Waitlisted'], ['declined', 'Declined'], ['enrolled', 'Enrolled'], ['draft', 'Drafts']]

export default function Applications() {
  const [f, setF] = useState({ page: 1, q: '', status: '', programmeId: '' })
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString()
  const { data, error, loading, reload } = useApi(`/admin/applications?${qs}`)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }))
  const counts = Object.fromEntries((data?.statusCounts ?? []).map((c) => [c.status, c.n]))

  return (
    <>
      <PageHeader title="Applications" intro="Review online applications, admit applicants and enrol them as students." />
      <Tabs tabs={STATUS_TABS.map(([k, l]) => [k, counts[k] ? `${l} (${counts[k]})` : l])} value={f.status} onChange={set('status')} />
      <div className="a-filters">
        <SearchInput value={f.q} onChange={set('q')} placeholder="Name, email or reference" />
        <ProgrammeSelect value={f.programmeId} onChange={set('programmeId')} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>Reference</th><th>Applicant</th><th>Programme</th><th>Cohort</th><th>Submitted</th><th>Status</th></tr></thead>
              <tbody>
                {data.items.length === 0 && <tr><td colSpan={6} className="a-empty">No applications.</td></tr>}
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap"><Link to={`/applications/${a.id}`}>{a.reference}</Link></td>
                    <td>{a.full_name || '—'}<div className="a-meta">{a.email} · {a.phone ?? ''}</div></td>
                    <td>{a.programme_name ?? '—'}</td>
                    <td>{a.cohort_name ?? '—'}</td>
                    <td className="nowrap">{date(a.submitted_at ?? a.updated_at)}</td>
                    <td><Badge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={set('page')} />
        </>
      )}
    </>
  )
}

const DOC_LABELS = { photo: 'Passport photograph', idDoc: 'Valid ID', certificate: 'Educational certificate', sponsorLetter: 'Sponsorship letter' }

export function ApplicationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: app, error, loading, reload, setData } = useApi(`/admin/applications/${id}`)
  const [modal, setModal] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [note, setNote] = useState('')
  const action = useAction()

  useEffect(() => {
    let url
    if (app?.documents?.photo) fetchImageUrl(`/admin/applications/${id}/documents/${app.documents.photo.id}`).then((u) => { url = u; setPhoto(u) })
    return () => url && URL.revokeObjectURL(url)
  }, [app?.documents?.photo, id])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const p = app.personal
  const g = app.guardian
  const b = app.background

  async function addNote(e) {
    e.preventDefault()
    const n = await action.run(() => api(`/admin/applications/${id}/notes`, { method: 'POST', body: { body: note } }))
    if (n) { setData((d) => ({ ...d, notes: [...d.notes, n] })); setNote('') }
  }

  return (
    <>
      <PageHeader
        title={p.fullName || app.reference}
        intro={<>{app.reference} · {app.programmeName ?? 'No programme'} · <Badge status={app.status} /></>}
        actions={
          <>
            <button type="button" className="a-btn a-btn--ghost" onClick={() => navigate('/applications')}>Back</button>
            {['received', 'under_review', 'waitlisted', 'declined'].includes(app.status) && (
              <>
                <button type="button" className="a-btn a-btn--ghost" onClick={() => setModal('status')}>Change status</button>
                <button type="button" className="a-btn" onClick={() => setModal('admit')}>Admit</button>
              </>
            )}
            {app.status === 'admitted' && <button type="button" className="a-btn" onClick={() => setModal('enrol')}>Enrol as student</button>}
            {['admitted', 'enrolled'].includes(app.status) && <button type="button" className="a-btn a-btn--ghost" onClick={() => fetchFile(`/admin/applications/${id}/admission-letter.pdf`, { open: true })}>Admission letter</button>}
            {app.student && <Link className="a-btn a-btn--ghost" to={`/students/${app.student.id}`}>Student {app.student.student_number}</Link>}
          </>
        }
      />
      <div className="a-grid2">
        <section className="panel a-stack">
          <div className="a-row" style={{ alignItems: 'flex-start' }}>
            {photo && <img src={photo} alt="Applicant" style={{ width: 96, height: 112, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />}
            <dl className="a-dl" style={{ flex: 1 }}>
              <div><dt>Email</dt><dd>{app.applicant.email}</dd></div>
              <div><dt>Phone</dt><dd>{p.phone || '—'}</dd></div>
              <div><dt>Date of birth</dt><dd>{date(p.dob)}</dd></div>
              <div><dt>Gender</dt><dd>{p.gender || '—'}</dd></div>
              <div><dt>Address</dt><dd>{[p.address, p.city, p.state].filter(Boolean).join(', ') || '—'}</dd></div>
              <div><dt>Submitted</dt><dd>{dateTime(app.submittedAt)}</dd></div>
            </dl>
          </div>
          <h3 className="a-section-title" style={{ margin: 0 }}>Guardian / sponsor</h3>
          <dl className="a-dl">
            <div><dt>Name</dt><dd>{g.name || '—'}</dd></div>
            <div><dt>Phone</dt><dd>{g.phone || '—'}</dd></div>
            <div><dt>Relationship</dt><dd>{g.relationship || '—'}</dd></div>
            <div><dt>Sponsor</dt><dd>{g.sponsor || '—'}</dd></div>
          </dl>
          <h3 className="a-section-title" style={{ margin: 0 }}>Background</h3>
          <dl className="a-dl">
            <div><dt>Education</dt><dd>{b.education || '—'}</dd></div>
            <div><dt>Experience</dt><dd>{b.experience || '—'}</dd></div>
          </dl>
          {b.goal && <Notice>{b.goal}</Notice>}
        </section>
        <section className="a-stack">
          <div className="panel">
            <h3 className="a-section-title" style={{ marginTop: 0 }}>Documents</h3>
            {Object.keys(app.documents).length === 0 ? <p className="muted">No documents uploaded.</p> : (
              <ul className="a-stack" style={{ listStyle: 'none', gap: 'var(--space-2)' }}>
                {Object.entries(app.documents).map(([kind, d]) => (
                  <li key={kind} className="a-row" style={{ justifyContent: 'space-between' }}>
                    <span>{DOC_LABELS[kind] ?? kind}<div className="a-meta">{d.name} · {fileSize(d.size)}</div></span>
                    <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => fetchFile(`/admin/applications/${id}/documents/${d.id}`, { open: true })}>View</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel">
            <h3 className="a-section-title" style={{ marginTop: 0 }}>Review notes</h3>
            {app.notes.length === 0 && <p className="muted">No notes yet.</p>}
            {app.notes.map((n) => (
              <div key={n.id} style={{ marginBottom: 'var(--space-3)' }}>
                <div className="a-meta">{n.author ?? 'Staff'} · {dateTime(n.created_at)}</div>
                <p style={{ whiteSpace: 'pre-line' }}>{n.body}</p>
              </div>
            ))}
            <form className="a-form" onSubmit={addNote}>
              <ErrorBox error={action.error} />
              <Field label="Add a note"><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Interview notes, calls, decisions…" /></Field>
              <div className="a-form__foot"><button className="a-btn" type="submit" disabled={!note.trim() || action.busy}>Add note</button></div>
            </form>
          </div>
        </section>
      </div>
      {modal === 'status' && <StatusModal app={app} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
      {(modal === 'admit' || modal === 'enrol') && <AdmitModal app={app} mode={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
    </>
  )
}

function StatusModal({ app, onClose, onDone }) {
  const [form, setForm] = useState({ status: app.status === 'received' ? 'under_review' : app.status, message: '', notify: true })
  const action = useAction()
  return (
    <Modal title="Change application status" onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <Field label="Status">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {['received', 'under_review', 'waitlisted', 'declined'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
        </Field>
        <Field label="Message to applicant (optional)"><textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
        <Checkbox label="Email the applicant about this change" checked={form.notify} onChange={(v) => setForm({ ...form, notify: v })} />
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy} onClick={() => action.run(() => api(`/admin/applications/${app.id}/status`, { method: 'PATCH', body: form })).then((r) => r && onDone())}>Save</button>
        </div>
      </div>
    </Modal>
  )
}

function AdmitModal({ app, mode, onClose, onDone }) {
  const { reloadLookups } = useLookups()
  const [form, setForm] = useState({ cohortId: app.cohort?.id ?? '', enrol: mode === 'enrol', message: '' })
  const action = useAction()
  const submit = () =>
    action.run(() =>
      mode === 'enrol'
        ? api(`/admin/applications/${app.id}/enrol`, { method: 'POST', body: { cohortId: form.cohortId || null } })
        : api(`/admin/applications/${app.id}/admit`, { method: 'POST', body: { cohortId: form.cohortId || null, enrol: form.enrol, message: form.message } }),
    ).then((r) => { if (r) { reloadLookups(); onDone() } })
  return (
    <Modal title={mode === 'enrol' ? 'Enrol as student' : 'Admit applicant'} onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <Field label="Cohort" error={action.errors.cohortId} hint="Only cohorts for this programme are listed. Create one under Cohorts if needed.">
          <CohortSelect value={form.cohortId} onChange={(v) => setForm({ ...form, cohortId: v })} programmeId={app.programmeId} allowEmpty={mode === 'enrol' ? 'Select cohort…' : 'Decide later'} className="" />
        </Field>
        {mode === 'admit' && (
          <>
            <Checkbox label="Enrol immediately" hint="Creates the student record and ID, switches their account to the student portal and raises tuition charges." checked={form.enrol} onChange={(v) => setForm({ ...form, enrol: v })} />
            <Field label="Message in the offer email (optional)"><textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
            <Notice>The applicant receives an email with their admission letter (PDF) attached.</Notice>
          </>
        )}
        {mode === 'enrol' && <Notice>This creates the student record and ID number, moves the account to the student portal and raises tuition charges from the programme’s fee plan.</Notice>}
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy || ((mode === 'enrol' || form.enrol) && !form.cohortId)} onClick={submit}>{mode === 'enrol' || form.enrol ? 'Admit & enrol' : 'Admit'}</button>
        </div>
      </div>
    </Modal>
  )
}
