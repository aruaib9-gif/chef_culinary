'use client'
import { useState } from 'react'
import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { dateTime, humanize } from '../lib/format.js'
import { PageHeader, Loading, ErrorBox, Badge, Field, Checkbox, ProgrammeSelect, CohortSelect, Notice, Tabs, useAction } from '../components/ui.jsx'

// Announcements to the student portal and bulk email to leads, students or alumni (spec §6.2, §9.5).
export default function Messaging() {
  const [tab, setTab] = useState('announcements')
  return (
    <>
      <PageHeader title="Announcements & messaging" />
      <Tabs tabs={[['announcements', 'Portal announcements'], ['bulk', 'Bulk email']]} value={tab} onChange={setTab} />
      {tab === 'announcements' ? <Announcements /> : <BulkEmail />}
    </>
  )
}

function Announcements() {
  const { data, error, loading, reload } = useApi('/admin/announcements')
  const blank = { title: '', body: '', audience: 'all', programmeId: '', cohortId: '', isPinned: false, expiresAt: '', emailCopy: false }
  const [form, setForm] = useState(blank)
  const action = useAction()
  async function post() {
    const r = await action.run(() => api('/admin/announcements', { method: 'POST', body: form }), 'posted')
    if (r) { setForm(blank); reload() }
  }
  return (
    <div className="a-grid2">
      <section className="panel a-form">
        <h2 className="a-section-title" style={{ margin: 0 }}>New announcement</h2>
        {action.ok && <Notice tone="success">Posted to the student portal.</Notice>}
        <ErrorBox error={action.error} />
        <Field label="Title" required error={action.errors.title}><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Message" required error={action.errors.body}><textarea rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
        <div className="a-form__row">
          <Field label="Audience">
            <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
              <option value="all">All students</option><option value="programme">A programme</option><option value="cohort">A cohort</option>
            </select>
          </Field>
          {form.audience === 'programme' && <Field label="Programme" error={action.errors.programmeId}><ProgrammeSelect value={form.programmeId} onChange={(v) => setForm({ ...form, programmeId: v })} allowEmpty="Select…" className="" /></Field>}
          {form.audience === 'cohort' && <Field label="Cohort" error={action.errors.cohortId}><CohortSelect value={form.cohortId} onChange={(v) => setForm({ ...form, cohortId: v })} allowEmpty="Select…" className="" /></Field>}
          <Field label="Hide after"><input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field>
        </div>
        <Checkbox label="Pin to the top of the notice board" checked={form.isPinned} onChange={(v) => setForm({ ...form, isPinned: v })} />
        <Checkbox label="Also send as an email to these students" checked={form.emailCopy} onChange={(v) => setForm({ ...form, emailCopy: v })} />
        <div className="a-form__foot"><button type="button" className="a-btn" disabled={action.busy || !form.title || !form.body} onClick={post}>Post announcement</button></div>
      </section>
      <section>
        {loading ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
          <div className="a-stack">
            {data.length === 0 && <p className="muted">No announcements yet.</p>}
            {data.map((a) => (
              <article key={a.id} className="panel">
                <div className="a-row" style={{ justifyContent: 'space-between' }}>
                  <strong>{a.is_pinned && '📌 '}{a.title}</strong>
                  <button type="button" className="a-link" onClick={async () => { if (window.confirm('Delete this announcement?')) { await api(`/admin/announcements/${a.id}`, { method: 'DELETE' }); reload() } }}>Delete</button>
                </div>
                <div className="a-meta">{dateTime(a.created_at)} · {a.author ?? ''} · {a.audience === 'all' ? 'All students' : a.cohort_name ?? a.programme_name}{a.expires_at ? ` · until ${dateTime(a.expires_at)}` : ''}</div>
                <p style={{ marginTop: 'var(--space-2)', whiteSpace: 'pre-line' }}>{a.body}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

const LEAD_STATUSES = ['new', 'contacted', 'interested', 'applied', 'enrolled', 'not_interested']

function BulkEmail() {
  const { isSuper } = useAuth()
  const [form, setForm] = useState({ audience: 'leads', leadStatus: '', cohortId: '', subject: '', body: '' })
  const [preview, setPreview] = useState(null)
  const action = useAction()
  const log = useApi(isSuper ? '/admin/message-log?pageSize=20' : null)
  const change = (patch) => { setForm({ ...form, ...patch }); setPreview(null) }

  return (
    <div className="a-grid2">
      <section className="panel a-form">
        <h2 className="a-section-title" style={{ margin: 0 }}>Compose</h2>
        {!isSuper && <Notice>Only super admins can send bulk email. You can preview recipients.</Notice>}
        <ErrorBox error={action.error} />
        <div className="a-form__row">
          <Field label="Send to">
            <select value={form.audience} onChange={(e) => change({ audience: e.target.value })}>
              <option value="leads">Leads (who consented)</option><option value="students">All active students</option><option value="cohort">One cohort</option><option value="alumni">Alumni (graduated)</option>
            </select>
          </Field>
          {form.audience === 'leads' && (
            <Field label="Lead status"><select value={form.leadStatus} onChange={(e) => change({ leadStatus: e.target.value })}><option value="">Any</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>
          )}
          {form.audience === 'cohort' && <Field label="Cohort"><CohortSelect value={form.cohortId} onChange={(v) => change({ cohortId: v })} allowEmpty="Select…" className="" /></Field>}
        </div>
        <Field label="Subject" required error={action.errors.subject}><input value={form.subject} onChange={(e) => change({ subject: e.target.value })} placeholder="Open day this Saturday — you’re invited" /></Field>
        <Field label="Message" required error={action.errors.body} hint="Separate paragraphs with a blank line. Sent with the academy’s branded email layout."><textarea rows={8} value={form.body} onChange={(e) => change({ body: e.target.value })} /></Field>
        {preview && <Notice tone={preview.count ? 'info' : 'warn'}>{preview.count} recipient(s){preview.sample.length ? `, e.g. ${preview.sample.join(', ')}` : ''}.{!preview.emailConfigured && ' SMTP is not configured — messages will be logged, not delivered.'}</Notice>}
        <div className="a-form__foot">
          <button type="button" className="a-btn a-btn--ghost" disabled={!form.subject || !form.body} onClick={async () => setPreview(await action.run(() => api('/admin/messaging/preview', { method: 'POST', body: form })))}>Preview recipients</button>
          {isSuper && <button type="button" className="a-btn" disabled={!preview?.count || action.busy} onClick={async () => {
            if (!window.confirm(`Send "${form.subject}" to ${preview.count} recipients?`)) return
            const r = await action.run(() => api('/admin/messaging/send', { method: 'POST', body: form }))
            if (r) { action.reset(); window.alert(`Queued ${r.queued} emails.`); setPreview(null); log.reload() }
          }}>Send</button>}
        </div>
      </section>
      {isSuper && (
        <section>
          <h2 className="a-section-title" style={{ marginTop: 0 }}>Recent emails</h2>
          {log.loading ? <Loading /> : log.data && (
            <div className="a-table-wrap">
              <table className="a-table">
                <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
                <tbody>{log.data.items.map((m) => <tr key={m.id}><td className="nowrap">{dateTime(m.created_at)}</td><td>{m.recipient}</td><td>{m.subject}</td><td><Badge status={m.status} /></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
