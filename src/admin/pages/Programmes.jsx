'use client'
import { useState } from 'react'
import { useApi } from '../lib/useApi.js'
import { api, fetchFile, uploadFile } from '../lib/api.js'
import { useAuth, useLookups } from '../lib/auth.jsx'
import { money, fileSize } from '../lib/format.js'
import { feeBreakdown } from '@cca/shared/format'
import { PageHeader, Loading, ErrorBox, Badge, Modal, Field, Checkbox, Tabs, Notice, useAction } from '../components/ui.jsx'

const TYPES = { short: 'Short course', main: 'Main course', diploma: 'Diploma', professional: 'Professional', cohort: 'Sponsored cohort' }

// Tuition, registration, VAT and total, in that order (amounts stored in kobo).
function FeeLines({ kobo }) {
  const f = feeBreakdown(kobo / 100)
  const rows = [['Tuition', f.tuition], ['Registration', f.registration], ['VAT (7.5%)', f.vat]]
  return (
    <dl className="a-fees">
      {rows.map(([label, n]) => <div key={label}><dt>{label}</dt><dd>{money(n * 100)}</dd></div>)}
      <div className="a-fees__total"><dt>Total</dt><dd>{money(f.total * 100)}</dd></div>
    </dl>
  )
}

// Programmes (fees, instalments, page content) and courses (spec §5, §9.3).
export default function Programmes() {
  const [tab, setTab] = useState('programmes')
  return (
    <>
      <PageHeader title="Programmes & courses" intro="Everything here is shown on the public website. Changes go live immediately." />
      <Tabs tabs={[['programmes', 'Programmes'], ['courses', 'Courses']]} value={tab} onChange={setTab} />
      {tab === 'programmes' ? <ProgrammeList /> : <CourseList />}
    </>
  )
}

function ProgrammeList() {
  const { data, error, loading, reload } = useApi('/admin/programmes')
  const [editing, setEditing] = useState(null)
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <>
      <div className="a-row" style={{ marginBottom: 'var(--space-3)' }}><button type="button" className="a-btn" onClick={() => setEditing({})}>New programme</button></div>
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Programme</th><th>Type</th><th>Duration</th><th className="num">Fee</th><th>Courses</th><th>Course outline</th><th className="num">Students</th><th>Website</th><th /></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.name}</strong><div className="a-meta">/{p.slug}</div></td>
                <td>{TYPES[p.type]}</td>
                <td>{p.duration_weeks ? `${p.duration_weeks} weeks` : '—'}<div className="a-meta">{p.schedule}</div></td>
                <td className="num">{p.fee_kobo != null ? <FeeLines kobo={p.fee_kobo} /> : <Badge status="pending">To be supplied</Badge>}{p.instalment_plan.length > 1 && <div className="a-meta">{p.instalment_plan.length} instalments</div>}</td>
                <td>{p.courses.length}</td>
                <td><OutlineCell path={`/admin/programmes/${p.id}/outline`} outline={p.outline} onChange={reload} /></td>
                <td className="num">{p.active_students}</td>
                <td>{p.is_published ? <Badge status="published" /> : <Badge status="draft">Hidden</Badge>}</td>
                <td><button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setEditing(p)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <ProgrammeModal programme={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

// Upload / view / replace / remove a course outline document (shown in the student portal).
function OutlineCell({ path, outline, onChange }) {
  const action = useAction()
  async function upload(file) {
    if (!file) return
    if (await action.run(async () => api(path, { method: 'POST', body: { fileId: await uploadFile(file, 'course_outline') } }))) onChange()
  }
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      {outline ? (
        <span><button type="button" className="a-link" onClick={() => fetchFile(path, { open: true })}>{outline.filename}</button> <span className="a-meta">{fileSize(outline.size)}</span></span>
      ) : <span className="a-meta">None</span>}
      <span className="a-row" style={{ gap: 'var(--space-2)' }}>
        <label className="a-link" style={{ cursor: 'pointer' }}>
          {action.busy ? 'Uploading…' : outline ? 'Replace' : 'Upload'}
          <input type="file" hidden accept=".pdf,.docx,.pptx,.xlsx,image/*" disabled={action.busy} onChange={(e) => { upload(e.target.files[0]); e.target.value = '' }} />
        </label>
        {outline && <button type="button" className="a-link" onClick={async () => { if (window.confirm('Remove this outline? Students will no longer see it.') && (await action.run(() => api(path, { method: 'DELETE' })))) onChange() }}>Remove</button>}
      </span>
      {action.error && <span className="a-field__error">{action.error.message}</span>}
    </div>
  )
}

function ProgrammeModal({ programme: p, onClose, onSaved }) {
  const { courses, reloadLookups } = useLookups()
  const { isSuper } = useAuth()
  const [form, setForm] = useState({
    slug: p.slug ?? '', name: p.name ?? '', type: p.type ?? 'main', summary: p.summary ?? '', description: p.description ?? '',
    durationWeeks: p.duration_weeks ?? '', schedule: p.schedule ?? '', fee: p.fee_kobo != null ? p.fee_kobo / 100 : '',
    applicationFee: p.application_fee_kobo ? p.application_fee_kobo / 100 : '', feeCovers: (p.fee_covers ?? []).join('\n'),
    instalmentPlan: p.instalment_plan ?? [], intakeDates: p.intake_dates ?? '', applicationDeadline: p.application_deadline ?? '',
    entryRequirements: p.entry_requirements ?? '', curriculum: p.curriculum ?? '', outcomes: p.outcomes ?? '', certificateAwarded: p.certificate_awarded ?? '',
    careers: p.careers ?? '', isPublished: p.is_published ?? false, sortOrder: p.sort_order ?? 0, courseIds: (p.courses ?? []).map((c) => c.id),
  })
  const action = useAction()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const plan = form.instalmentPlan
  const setPlan = (i, k, v) => setForm({ ...form, instalmentPlan: plan.map((x, j) => (j === i ? { ...x, [k]: v } : x)) })
  const planTotal = plan.reduce((s, x) => s + Number(x.percent || 0), 0)

  async function save() {
    const body = {
      ...form,
      durationWeeks: form.durationWeeks || null,
      feeKobo: form.fee === '' ? null : Math.round(Number(form.fee) * 100),
      applicationFeeKobo: Math.round(Number(form.applicationFee || 0) * 100),
      feeCovers: form.feeCovers.split('\n').map((s) => s.trim()).filter(Boolean),
      instalmentPlan: plan.map((x) => ({ label: x.label, percent: Number(x.percent), dueWeeks: Number(x.dueWeeks || 0) })),
    }
    const r = await action.run(() => (p.id ? api(`/admin/programmes/${p.id}`, { method: 'PUT', body }) : api('/admin/programmes', { method: 'POST', body })))
    if (r) { reloadLookups(); onSaved() }
  }

  return (
    <Modal title={p.id ? `Edit ${p.name}` : 'New programme'} onClose={onClose} wide>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <div className="a-form__row">
          <Field label="Name" required error={action.errors.name}><input value={form.name} onChange={set('name')} /></Field>
          <Field label="URL slug" required error={action.errors.slug} hint="e.g. pastry-and-mixology"><input value={form.slug} onChange={set('slug')} /></Field>
          <Field label="Type"><select value={form.type} onChange={set('type')}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <Field label="Short description" error={action.errors.summary}><input value={form.summary} onChange={set('summary')} /></Field>
        <div className="a-form__row">
          <Field label="Duration (weeks)"><input type="number" min="1" value={form.durationWeeks} onChange={set('durationWeeks')} /></Field>
          <Field label="Class schedule"><input value={form.schedule} onChange={set('schedule')} placeholder="Mon, Wed, Fri" /></Field>
          <Field label="Tuition (₦)" hint="Before VAT and registration, which are added automatically. Blank = 'Fee on request'"><input type="number" min="0" value={form.fee} onChange={set('fee')} /></Field>
          <Field label="Application fee (₦)"><input type="number" min="0" value={form.applicationFee} onChange={set('applicationFee')} /></Field>
        </div>
        <fieldset className="panel" style={{ padding: 'var(--space-4)' }}>
          <legend className="a-field__label">Instalment plan {plan.length > 0 && `· ${planTotal}%`}</legend>
          {action.errors.instalmentPlan && <p className="a-field__error">{action.errors.instalmentPlan}</p>}
          {plan.length === 0 && <p className="a-meta">No plan — the full fee is due at enrolment.</p>}
          {plan.map((x, i) => (
            <div key={i} className="a-form__row" style={{ alignItems: 'end', marginBottom: 'var(--space-2)' }}>
              <Field label="Label"><input value={x.label} onChange={(e) => setPlan(i, 'label', e.target.value)} /></Field>
              <Field label="% of fee"><input type="number" min="1" max="100" value={x.percent} onChange={(e) => setPlan(i, 'percent', e.target.value)} /></Field>
              <Field label="Due (weeks after start)"><input type="number" min="0" value={x.dueWeeks} onChange={(e) => setPlan(i, 'dueWeeks', e.target.value)} /></Field>
              <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setForm({ ...form, instalmentPlan: plan.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <button type="button" className="a-link" onClick={() => setForm({ ...form, instalmentPlan: [...plan, { label: plan.length ? 'Balance' : 'Deposit', percent: plan.length ? 100 - planTotal : 50, dueWeeks: plan.length ? 8 : 0 }] })}>+ Add instalment</button>
        </fieldset>
        <Field label="What the fee covers" hint="One item per line"><textarea value={form.feeCovers} onChange={set('feeCovers')} /></Field>
        <div className="a-form__row">
          <Field label="Intake dates"><input value={form.intakeDates} onChange={set('intakeDates')} placeholder="January, May, September" /></Field>
          <Field label="Application deadline"><input type="date" value={form.applicationDeadline} onChange={set('applicationDeadline')} /></Field>
          <Field label="Certificate awarded"><input value={form.certificateAwarded} onChange={set('certificateAwarded')} placeholder="Certificate in Professional Cookery" /></Field>
        </div>
        <Field label="Full description"><textarea value={form.description} onChange={set('description')} /></Field>
        <Field label="Entry requirements"><textarea value={form.entryRequirements} onChange={set('entryRequirements')} /></Field>
        <Field label="Curriculum overview (theory and practical)"><textarea value={form.curriculum} onChange={set('curriculum')} /></Field>
        <Field label="Learning outcomes"><textarea value={form.outcomes} onChange={set('outcomes')} /></Field>
        <Field label="Career opportunities"><textarea value={form.careers} onChange={set('careers')} /></Field>
        <fieldset className="panel" style={{ padding: 'var(--space-4)' }}>
          <legend className="a-field__label">Courses in this programme (appear on result sheets)</legend>
          <div className="a-form__row">
            {courses.map((c) => (
              <Checkbox key={c.id} label={c.name} checked={form.courseIds.includes(c.id)} onChange={(on) => setForm({ ...form, courseIds: on ? [...form.courseIds, c.id] : form.courseIds.filter((x) => x !== c.id) })} />
            ))}
          </div>
        </fieldset>
        <div className="a-form__row">
          <Checkbox label="Show on the website" checked={form.isPublished} onChange={(v) => setForm({ ...form, isPublished: v })} />
          <Field label="Display order"><input type="number" value={form.sortOrder} onChange={set('sortOrder')} /></Field>
        </div>
        <div className="a-form__foot">
          {p.id && isSuper && (
            <button type="button" className="a-btn a-btn--danger" style={{ marginRight: 'auto' }} onClick={async () => { if (window.confirm('Delete this programme? Programmes with students, cohorts or applications can only be hidden.') && (await action.run(() => api(`/admin/programmes/${p.id}`, { method: 'DELETE' })))) { reloadLookups(); onSaved() } }}>Delete</button>
          )}
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy} onClick={save}>Save programme</button>
        </div>
      </div>
    </Modal>
  )
}

function CourseList() {
  const { data, error, loading, reload } = useApi('/admin/courses')
  const schemes = useApi('/admin/grading-schemes')
  const [editing, setEditing] = useState(null)
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <>
      <div className="a-row" style={{ marginBottom: 'var(--space-3)' }}><button type="button" className="a-btn" onClick={() => setEditing({})}>New course</button></div>
      <Notice>A course can belong to several programmes — link them from each programme’s edit screen. Upload a course outline (PDF or Word) and every student on a programme that includes the course can download it from their portal.</Notice>
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Course</th><th>Type</th><th>Programmes</th><th>Course outline</th><th>Grading</th><th>Assessed</th><th /></tr></thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong><div className="a-meta">{c.slug}</div></td>
                <td>{c.type}</td>
                <td>{c.programmes.map((p) => p.name).join(', ') || '—'}</td>
                <td><OutlineCell path={`/admin/courses/${c.id}/outline`} outline={c.outline} onChange={reload} /></td>
                <td>{c.grading_scheme_name ?? 'Default scheme'}</td>
                <td>{c.is_assessed ? 'Yes' : 'No'}</td>
                <td><button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setEditing(c)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <CourseModal course={editing} schemes={schemes.data ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function CourseModal({ course: c, schemes, onClose, onSaved }) {
  const { reloadLookups } = useLookups()
  const [form, setForm] = useState({ name: c.name ?? '', slug: c.slug ?? '', type: c.type ?? 'Theory', description: c.description ?? '', isAssessed: c.is_assessed ?? true, gradingSchemeId: c.grading_scheme_id ?? '' })
  const action = useAction()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  async function save() {
    if (await action.run(() => (c.id ? api(`/admin/courses/${c.id}`, { method: 'PUT', body: form }) : api('/admin/courses', { method: 'POST', body: form })))) { reloadLookups(); onSaved() }
  }
  return (
    <Modal title={c.id ? `Edit ${c.name}` : 'New course'} onClose={onClose}>
      <div className="a-form">
        <ErrorBox error={action.error} />
        <Field label="Name" required error={action.errors.name}><input value={form.name} onChange={set('name')} /></Field>
        <div className="a-form__row">
          <Field label="Code / slug" required error={action.errors.slug}><input value={form.slug} onChange={set('slug')} placeholder="food-production" /></Field>
          <Field label="Type"><select value={form.type} onChange={set('type')}>{['Theory', 'Practical', 'Theory and practical'].map((t) => <option key={t}>{t}</option>)}</select></Field>
        </div>
        <Field label="Grading scheme"><select value={form.gradingSchemeId} onChange={set('gradingSchemeId')}><option value="">Default scheme</option>{schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Description"><textarea value={form.description} onChange={set('description')} /></Field>
        <Checkbox label="Assessed in the portal (appears on result sheets)" checked={form.isAssessed} onChange={(v) => setForm({ ...form, isAssessed: v })} />
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={action.busy} onClick={save}>Save course</button>
        </div>
      </div>
    </Modal>
  )
}
