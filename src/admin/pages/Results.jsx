'use client'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from '@/lib/router'
import { totalScore, gradeFor, validateScores } from '@cca/shared/grading'
import { useApi } from '../lib/useApi.js'
import { api, fetchFile } from '../lib/api.js'
import { useAuth, useLookups } from '../lib/auth.jsx'
import { dateTime } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Badge, CohortSelect, CourseSelect, Modal, Field, Checkbox, Notice, Tabs, useAction } from '../components/ui.jsx'

// Results upload and grading (spec §9.2): score entry, CSV import, publish, corrections, analytics, grading scheme.
export default function Results() {
  const { isSuper } = useAuth()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState('entry')
  const cohortId = params.get('cohortId') ?? ''
  const courseId = params.get('courseId') ?? ''
  const { cohorts } = useLookups()
  const cohort = cohorts.find((c) => c.id === cohortId)
  const setSel = (k, v) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    if (k === 'cohortId') next.delete('courseId')
    setParams(next, { replace: true })
  }

  const tabs = [['entry', 'Score entry'], ['analytics', 'Analytics'], ['corrections', 'Corrections log']]
  if (isSuper) tabs.push(['scheme', 'Grading scheme'])

  return (
    <>
      <PageHeader title="Results & grading" intro="Enter or upload scores. Totals and grades are calculated from the grading scheme; students only see published results." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab !== 'scheme' && (
        <div className="a-filters">
          <CohortSelect value={cohortId} onChange={(v) => setSel('cohortId', v)} allowEmpty="Select cohort…" />
          {tab === 'entry' && <CourseSelect value={courseId} onChange={(v) => setSel('courseId', v)} programmeId={cohort?.programme_id} />}
          {cohortId && tab !== 'scheme' && <button type="button" className="a-btn a-btn--ghost" onClick={() => fetchFile(`/admin/results/export.csv?cohortId=${cohortId}`)}>Export cohort results</button>}
        </div>
      )}
      {tab === 'entry' && (cohortId && courseId ? <ScoreSheet key={`${cohortId}-${courseId}`} cohortId={cohortId} courseId={courseId} /> : <Notice>Choose a cohort and course to enter scores.</Notice>)}
      {tab === 'analytics' && (cohortId ? <Analytics cohortId={cohortId} /> : <Notice>Choose a cohort.</Notice>)}
      {tab === 'corrections' && <Corrections cohortId={cohortId} />}
      {tab === 'scheme' && <SchemeEditor />}
    </>
  )
}

function ScoreSheet({ cohortId, courseId }) {
  const { isSuper } = useAuth()
  const { data, error, loading, reload } = useApi(`/admin/results/sheet?cohortId=${cohortId}&courseId=${courseId}`)
  const [rows, setRows] = useState([])
  const [dirty, setDirty] = useState(new Set())
  const [modal, setModal] = useState(null)
  const action = useAction()

  useEffect(() => {
    if (data) {
      setRows(data.rows.map((r) => ({ ...r, scores: { ...(r.scores ?? {}) } })))
      setDirty(new Set())
    }
  }, [data])

  const scheme = data?.scheme.definition
  const fields = useMemo(() => scheme?.components.flatMap((c) => (c.parts.length ? c.parts : [c])) ?? [], [scheme])
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  const update = (sid, field, value) => {
    setRows((rs) => rs.map((r) => (r.student_id === sid ? { ...r, scores: { ...r.scores, [field]: value === '' ? '' : value } } : r)))
    setDirty((d) => new Set(d).add(sid))
  }
  const changed = rows.filter((r) => dirty.has(r.student_id))
  const changedPublished = changed.some((r) => r.status === 'published')
  const invalid = changed.some((r) => validateScores(r.scores, scheme).length > 0)
  const counts = { draft: rows.filter((r) => r.status === 'draft').length, published: rows.filter((r) => r.status === 'published').length }

  async function save(reason) {
    const body = { cohortId, courseId, reason, rows: changed.map((r) => ({ studentId: r.student_id, scores: r.scores })) }
    const res = await action.run(() => api('/admin/results/sheet', { method: 'PUT', body }), 'saved')
    if (res) { setModal(null); reload() }
  }

  async function publish(publish) {
    const msg = publish ? `Publish ${counts.draft} draft result(s) for ${data.course.name}? Students will be notified by email.` : `Unpublish all ${counts.published} result(s) for ${data.course.name}? Students will no longer see them.`
    if (!window.confirm(msg)) return
    if (await action.run(() => api('/admin/results/publish', { method: 'POST', body: { cohortId, courseId, publish } }))) reload()
  }

  return (
    <>
      <div className="a-row" style={{ justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <div className="a-meta">{data.cohort.programme_name} · {data.cohort.name} · {data.course.name} · scheme “{data.scheme.name}” · {counts.published} published, {counts.draft} draft</div>
        <div className="a-actions">
          <button type="button" className="a-btn a-btn--ghost" onClick={() => fetchFile(`/admin/results/template.csv?cohortId=${cohortId}&courseId=${courseId}`)}>CSV template</button>
          <button type="button" className="a-btn a-btn--ghost" onClick={() => setModal('import')}>Upload CSV</button>
          {isSuper && counts.published > 0 && <button type="button" className="a-btn a-btn--ghost" onClick={() => publish(false)}>Unpublish</button>}
          {isSuper && <button type="button" className="a-btn a-btn--ghost" disabled={!counts.draft || dirty.size > 0} onClick={() => publish(true)} title={dirty.size ? 'Save changes first' : undefined}>Publish {counts.draft || ''}</button>}
          <button type="button" className="a-btn" disabled={!dirty.size || invalid || action.busy} onClick={() => (changedPublished ? setModal('reason') : save())}>Save {dirty.size || ''}</button>
        </div>
      </div>
      {action.ok === 'saved' && <Notice tone="success">Scores saved as draft{isSuper ? '' : ' — a super admin will publish them'}.</Notice>}
      <ErrorBox error={action.error} />
      {!isSuper && <Notice>Staff can enter and correct scores. Publishing to students is done by a super admin.</Notice>}
      <div className="a-table-wrap">
        <table className="a-table">
          <thead>
            <tr>
              <th>Student</th>
              {fields.map((f) => <th key={f.id} className="num" title={f.label}>{f.label.length > 18 ? `${f.label.slice(0, 16)}…` : f.label} /{f.max}</th>)}
              <th className="num">Total</th><th>Grade</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={fields.length + 4} className="a-empty">No students in this cohort.</td></tr>}
            {rows.map((r) => {
              const bad = new Set(validateScores(r.scores, scheme))
              const hasAny = fields.some((f) => r.scores[f.id] !== undefined && r.scores[f.id] !== '')
              const total = Math.round(totalScore(r.scores, scheme) * 10) / 10
              return (
                <tr key={r.student_id} style={dirty.has(r.student_id) ? { background: '#fffaf0' } : undefined}>
                  <td className="nowrap">{r.last_name}, {r.first_name}<div className="a-meta">{r.student_number}</div></td>
                  {fields.map((f) => (
                    <td key={f.id} className="num">
                      <input className="score-input" type="number" min="0" max={f.max} step="0.5" inputMode="decimal" aria-label={`${r.first_name} ${r.last_name} ${f.label}`} aria-invalid={bad.has(f.id)}
                        value={r.scores[f.id] ?? ''} onChange={(e) => update(r.student_id, f.id, e.target.value)} />
                    </td>
                  ))}
                  <td className="num"><strong>{hasAny ? total : '—'}</strong></td>
                  <td>{hasAny ? gradeFor(total, scheme).grade : '—'}</td>
                  <td>{r.status ? <Badge status={r.status} /> : <span className="a-meta">Not entered</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="a-meta" style={{ marginTop: 'var(--space-2)' }}>Grades: {scheme.bands.map((b) => `${b.grade} ${b.min}–${b.max}`).join(' · ')}. Clearing all scores for a draft row removes it.</p>
      {modal === 'reason' && <ReasonModal busy={action.busy} onClose={() => setModal(null)} onSave={save} />}
      {modal === 'import' && <ImportScores cohortId={cohortId} courseId={courseId} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
    </>
  )
}

function ReasonModal({ onClose, onSave, busy }) {
  const [reason, setReason] = useState('')
  return (
    <Modal title="Correct published results" onClose={onClose}>
      <div className="a-form">
        <Notice tone="warn">You are changing results students can already see. The change and your reason are recorded permanently in the audit trail.</Notice>
        <Field label="Reason for the correction" required><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Transcription error — practical score re-checked with instructor" /></Field>
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="a-btn" disabled={busy || reason.trim().length < 5} onClick={() => onSave(reason.trim())}>Save correction</button>
        </div>
      </div>
    </Modal>
  )
}

function ImportScores({ cohortId, courseId, onClose, onDone }) {
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const action = useAction()
  async function send(dry) {
    const form = new FormData()
    form.append('file', file)
    const r = await action.run(() => api(`/admin/results/import?cohortId=${cohortId}&courseId=${courseId}&dryRun=${dry ? 1 : 0}`, { method: 'POST', form }))
    if (r) { setResult(r); if (!r.dryRun) setTimeout(onDone, 1000) }
  }
  return (
    <Modal title="Upload scores from CSV" onClose={onClose} wide>
      <div className="a-form">
        <p className="muted">Download the CSV template (it lists every student in the cohort), fill in the score columns in Excel, save as CSV and upload it here. The file is checked before anything is saved; scores land as drafts.</p>
        <ErrorBox error={action.error} />
        <Field label="CSV file"><input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files[0] ?? null); setResult(null) }} /></Field>
        {result && (result.dryRun
          ? <Notice tone={result.errors.length ? 'warn' : 'success'}>{result.valid} rows valid{result.errors.length ? `, ${result.errors.length} with problems — fix them and check again.` : '.'}{result.missingStudents ? ` ${result.missingStudents} student(s) in the cohort are not in the file.` : ''}</Notice>
          : <Notice tone="success">Saved {result.saved} rows{result.corrected ? ` (${result.corrected} corrections to published results)` : ''}.</Notice>)}
        {result?.errors?.length > 0 && (
          <div className="a-table-wrap" style={{ maxHeight: 240 }}>
            <table className="a-table"><thead><tr><th>Line</th><th>Problem</th></tr></thead><tbody>{result.errors.map((e) => <tr key={`${e.line}${e.error}`}><td>{e.line}</td><td>{e.error}</td></tr>)}</tbody></table>
          </div>
        )}
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Close</button>
          <button type="button" className="a-btn a-btn--ghost" disabled={!file || action.busy} onClick={() => send(true)}>Check file</button>
          <button type="button" className="a-btn" disabled={!result?.dryRun || result.errors.length > 0 || action.busy} onClick={() => send(false)}>Save scores</button>
        </div>
      </div>
    </Modal>
  )
}

function Analytics({ cohortId }) {
  const { data, error, loading, reload } = useApi(`/admin/results/analytics?cohortId=${cohortId}`)
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <div className="a-stack">
      <section>
        <h3 className="a-section-title">By course (pass mark {data.passMark})</h3>
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Course</th><th className="num">Entries</th><th className="num">Average</th><th className="num">Highest</th><th className="num">Lowest</th><th className="num">Pass rate</th><th className="num">Published</th></tr></thead>
            <tbody>
              {data.byCourse.length === 0 && <tr><td colSpan={7} className="a-empty">No results yet.</td></tr>}
              {data.byCourse.map((c) => <tr key={c.id}><td>{c.name}</td><td className="num">{c.entries}</td><td className="num">{c.average}</td><td className="num">{c.highest}</td><td className="num">{c.lowest}</td><td className="num">{c.pass_rate}%</td><td className="num">{c.published}/{c.entries}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
      <div className="a-grid2">
        <section>
          <h3 className="a-section-title">Top performers</h3>
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>#</th><th>Student</th><th className="num">Average</th><th className="num">Courses</th></tr></thead>
              <tbody>{data.topPerformers.map((s) => <tr key={s.student_id}><td>{s.position}</td><td>{s.first_name} {s.last_name}<div className="a-meta">{s.student_number}</div></td><td className="num">{s.average}</td><td className="num">{s.courses}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
        <section>
          <h3 className="a-section-title">Students at risk</h3>
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>Student</th><th className="num">Average</th><th className="num">Failed courses</th></tr></thead>
              <tbody>
                {data.atRisk.length === 0 && <tr><td colSpan={3} className="a-empty">Nobody at risk.</td></tr>}
                {data.atRisk.map((s) => <tr key={s.id}><td>{s.first_name} {s.last_name}<div className="a-meta">{s.student_number}</div></td><td className="num">{s.average}</td><td className="num">{s.failed_courses ? <Badge status="failed">{s.failed_courses}</Badge> : 0}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section>
        <h3 className="a-section-title">Grade distribution</h3>
        <div className="a-row">{data.grades.map((g) => <span key={g.grade} className="a-badge a-badge--info">{g.grade}: {g.n}</span>)}</div>
      </section>
    </div>
  )
}

function Corrections({ cohortId }) {
  const { data, error, loading, reload } = useApi(`/admin/results/corrections${cohortId ? `?cohortId=${cohortId}` : ''}`)
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <div className="a-table-wrap">
      <table className="a-table">
        <thead><tr><th>When</th><th>Student</th><th>Course</th><th>Change</th><th>Reason</th><th>By</th></tr></thead>
        <tbody>
          {data.length === 0 && <tr><td colSpan={6} className="a-empty">No corrections to published results.</td></tr>}
          {data.map((c) => (
            <tr key={c.id}>
              <td className="nowrap">{dateTime(c.created_at)}</td>
              <td>{c.first_name} {c.last_name}<div className="a-meta">{c.student_number}</div></td>
              <td>{c.course_name}</td>
              <td className="nowrap">{c.before.total} ({c.before.grade}) → <strong>{c.after.total} ({c.after.grade})</strong></td>
              <td>{c.reason}</td>
              <td>{c.changed_by_name ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Editable grading bands and score components (spec §8.3.1 — not hard-coded).
function SchemeEditor() {
  const { data, error, loading, reload } = useApi('/admin/grading-schemes')
  const [selected, setSelected] = useState(null)
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const scheme = selected === 'new' ? { name: 'New scheme', is_default: false, definition: data.find((s) => s.is_default)?.definition } : data.find((s) => s.id === selected) ?? data.find((s) => s.is_default) ?? data[0]
  return (
    <>
      <div className="a-filters">
        <select className="a-input" value={selected === 'new' ? 'new' : scheme?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>
          {data.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_default ? ' (default)' : ''}</option>)}
          <option value="new">+ New scheme (e.g. for a short course)</option>
        </select>
      </div>
      {scheme && <SchemeForm key={selected ?? scheme.id} scheme={scheme} onSaved={(s) => { setSelected(s.id); reload() }} />}
    </>
  )
}

function SchemeForm({ scheme, onSaved }) {
  const [name, setName] = useState(scheme.name)
  const [isDefault, setIsDefault] = useState(scheme.is_default)
  const [def, setDef] = useState(() => structuredClone(scheme.definition))
  const action = useAction()
  const setBand = (i, k, v) => setDef((d) => ({ ...d, bands: d.bands.map((b, j) => (j === i ? { ...b, [k]: k === 'min' || k === 'max' ? Number(v) : v } : b)) }))
  const setComp = (i, k, v) => setDef((d) => ({ ...d, components: d.components.map((c, j) => (j === i ? { ...c, [k]: k === 'max' ? Number(v) : v } : c)) }))
  const setPart = (ci, pi, k, v) => setDef((d) => ({ ...d, components: d.components.map((c, j) => (j === ci ? { ...c, parts: c.parts.map((p, q) => (q === pi ? { ...p, [k]: k === 'max' ? Number(v) : v } : p)) } : c)) }))
  const total = def.components.reduce((s, c) => s + Number(c.max || 0), 0)

  async function save() {
    const body = { name, isDefault, definition: def }
    const r = await action.run(() => (scheme.id ? api(`/admin/grading-schemes/${scheme.id}`, { method: 'PUT', body }) : api('/admin/grading-schemes', { method: 'POST', body })), 'saved')
    if (r) onSaved(r)
  }

  const errs = Object.entries(action.errors)
  return (
    <div className="panel a-form">
      {action.ok && <Notice tone="success">Grading scheme saved. New and edited results use it; existing results keep their saved grade until re-saved.</Notice>}
      <ErrorBox error={action.error} />
      {errs.length > 0 && <ul className="a-field__error">{errs.map(([k, v]) => <li key={k}>{v}</li>)}</ul>}
      <div className="a-form__row">
        <Field label="Scheme name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Checkbox label="Default scheme (used by courses without their own)" checked={isDefault} onChange={setIsDefault} />
      </div>
      <h3 className="a-section-title" style={{ margin: 0 }}>Grade bands</h3>
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Grade</th><th>Min</th><th>Max</th><th>Remark</th><th /></tr></thead>
          <tbody>
            {def.bands.map((b, i) => (
              <tr key={i}>
                <td><input className="score-input" value={b.grade} onChange={(e) => setBand(i, 'grade', e.target.value)} /></td>
                <td><input className="score-input" type="number" value={b.min} onChange={(e) => setBand(i, 'min', e.target.value)} /></td>
                <td><input className="score-input" type="number" value={b.max} onChange={(e) => setBand(i, 'max', e.target.value)} /></td>
                <td><input className="a-input" value={b.remark} onChange={(e) => setBand(i, 'remark', e.target.value)} /></td>
                <td><button type="button" className="a-link" onClick={() => setDef((d) => ({ ...d, bands: d.bands.filter((_, j) => j !== i) }))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><button type="button" className="a-link" onClick={() => setDef((d) => ({ ...d, bands: [...d.bands, { grade: '', min: 0, max: 0, remark: '' }] }))}>+ Add band</button></div>
      <h3 className="a-section-title" style={{ margin: 0 }}>Score components · total {total}/100</h3>
      {def.components.map((c, ci) => (
        <fieldset key={ci} className="panel" style={{ padding: 'var(--space-3)' }}>
          <div className="a-form__row" style={{ alignItems: 'end' }}>
            <Field label="Component"><input value={c.label} onChange={(e) => setComp(ci, 'label', e.target.value)} /></Field>
            <Field label="Field id" hint="Used in CSV uploads"><input value={c.id} onChange={(e) => setComp(ci, 'id', e.target.value)} /></Field>
            <Field label="Max marks"><input type="number" value={c.max} onChange={(e) => setComp(ci, 'max', e.target.value)} /></Field>
            <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setDef((d) => ({ ...d, components: d.components.filter((_, j) => j !== ci) }))}>Remove component</button>
          </div>
          {c.parts.map((p, pi) => (
            <div key={pi} className="a-form__row" style={{ alignItems: 'end', marginTop: 'var(--space-2)', paddingLeft: 'var(--space-4)' }}>
              <Field label="Part"><input value={p.label} onChange={(e) => setPart(ci, pi, 'label', e.target.value)} /></Field>
              <Field label="Field id"><input value={p.id} onChange={(e) => setPart(ci, pi, 'id', e.target.value)} /></Field>
              <Field label="Max"><input type="number" value={p.max} onChange={(e) => setPart(ci, pi, 'max', e.target.value)} /></Field>
              <button type="button" className="a-link" onClick={() => setDef((d) => ({ ...d, components: d.components.map((x, j) => (j === ci ? { ...x, parts: x.parts.filter((_, q) => q !== pi) } : x)) }))}>Remove</button>
            </div>
          ))}
          <div style={{ marginTop: 'var(--space-2)' }}>
            <button type="button" className="a-link" onClick={() => setDef((d) => ({ ...d, components: d.components.map((x, j) => (j === ci ? { ...x, parts: [...x.parts, { id: `part${x.parts.length + 1}`, label: 'New part', max: 0 }] } : x)) }))}>+ Add part</button>
            {c.parts.length > 0 && <span className="a-meta"> · parts total {c.parts.reduce((s, p) => s + Number(p.max || 0), 0)} / {c.max}</span>}
          </div>
        </fieldset>
      ))}
      <div><button type="button" className="a-link" onClick={() => setDef((d) => ({ ...d, components: [...d.components, { id: `component${d.components.length + 1}`, label: 'New component', max: 0, parts: [] }] }))}>+ Add component</button></div>
      <div className="a-form__foot"><button type="button" className="a-btn" disabled={action.busy} onClick={save}>Save scheme</button></div>
    </div>
  )
}
