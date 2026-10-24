import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { programmeTypes } from '@cca/shared/programmes'
import { states, lgasFor } from '../../lib/nigeria.js'
import { api, fetchImageUrl } from '../../lib/api.js'
import { useAuth } from '../../lib/auth.jsx'
import { useProgrammes } from '../../lib/useProgrammes.js'
import { date } from '../../lib/format.js'
import PageHeader from '../../components/ui/PageHeader.jsx'
import Button from '../../components/ui/Button.jsx'
import { Loading } from '../../components/portal/ui.jsx'
import './Apply.css'

const STEPS = ['Programme', 'Your details', 'Background', 'Documents', 'Review']
const FILE_CAP = 5 * 1024 * 1024 // matches the server's upload limit
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'
const DOC_ACCEPT = `${IMAGE_ACCEPT},application/pdf`

const docFields = [
  { id: 'photo', label: 'Passport photograph', required: true, accept: IMAGE_ACCEPT, hint: 'Clear headshot — JPG, PNG or WebP.' },
  { id: 'idDoc', label: 'Valid ID', required: true, accept: DOC_ACCEPT, hint: 'NIN, voter’s card, licence or passport — image or PDF.' },
  { id: 'certificate', label: 'Educational certificate', required: false, accept: DOC_ACCEPT, hint: 'Optional — your highest certificate (SSCE, OND, degree…).' },
  { id: 'sponsorLetter', label: 'Sponsorship letter', required: false, accept: DOC_ACCEPT, hint: 'Only if applying through a sponsor (e.g. SUPA ITF).' },
]

const emptyForm = {
  programme: '',
  personal: { fullName: '', dob: '', gender: '', phone: '', email: '', address: '', city: '', state: '' },
  guardian: { name: '', phone: '', relationship: '', sponsor: '' },
  background: { education: '', experience: '', goal: '' },
  documents: {},
}

// Maps server-side field errors back to the step that holds them.
const FIELD_STEP = { programme: 0, fullName: 1, dob: 1, phone: 1, email: 1, education: 2, experience: 2, photo: 3, idDoc: 3 }

export default function Apply() {
  const { user, loading: authLoading } = useAuth()
  const location = useLocation()
  if (authLoading) return <div className="container section"><Loading /></div>
  if (!user) return <SignInGate from={location.pathname + location.search} />
  return <ApplicationForm user={user} />
}

function SignInGate({ from }) {
  return (
    <>
      <PageHeader eyebrow="Admissions" title="Online application" intro="Create a free applicant account so you can save your progress, upload documents and track your application." />
      <section className="section">
        <div className="container apply-done">
          <h2>Start your application</h2>
          <p>It takes about 10 minutes. You’ll need a passport photograph and a valid ID.</p>
          <div className="apply-done__actions">
            <Button to="/portal/signup" state={{ from }}>Create an account</Button>
            <Button to="/portal/login" state={{ from }} variant="outline">I already have an account</Button>
          </div>
        </div>
      </section>
    </>
  )
}

function ApplicationForm({ user }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { programmes } = useProgrammes()
  const [form, setForm] = useState(emptyForm)
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState({ loading: true })
  const [existing, setExisting] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(null)
  const [consent, setConsent] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [uploading, setUploading] = useState(null)
  const dirty = useRef(false)

  const hydrate = useCallback((app) => {
    setForm({
      programme: app.programme || '',
      personal: { ...emptyForm.personal, email: user.email, ...app.personal },
      guardian: { ...emptyForm.guardian, ...app.guardian },
      background: { ...emptyForm.background, ...app.background },
      documents: app.documents ?? {},
    })
    setStep(Math.min(app.step || 0, STEPS.length - 1))
  }, [user.email])

  // Load the server-side draft (save-and-continue-later, spec §7).
  useEffect(() => {
    api('/applications/current')
      .then((app) => {
        if (app && app.status !== 'draft') {
          setExisting(app)
        } else if (app) {
          hydrate(app)
          setStatus({ loading: false, resumed: Boolean(app.programme || app.personal?.fullName) })
          return
        } else {
          const slug = params.get('programme')
          setForm((f) => ({ ...f, programme: slug ?? '', personal: { ...f.personal, fullName: user.fullName, phone: user.phone ?? '', email: user.email } }))
        }
        setStatus({ loading: false })
      })
      .catch((err) => setStatus({ loading: false, error: err }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave (debounced) whenever answers or the step change.
  useEffect(() => {
    if (!dirty.current || existing) return
    setSaveState('pending')
    const t = setTimeout(async () => {
      try {
        const { documents, ...rest } = form // eslint-disable-line no-unused-vars
        await api('/applications/current', { method: 'PUT', body: { ...rest, step } })
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    }, 800)
    return () => clearTimeout(t)
  }, [form, step, existing])

  const change = (fn) => { dirty.current = true; setForm(fn) }
  const setPersonal = (field, value) => change((f) => ({ ...f, personal: { ...f.personal, [field]: value } }))
  const setGuardian = (field, value) => change((f) => ({ ...f, guardian: { ...f.guardian, [field]: value } }))
  const setBackground = (field, value) => change((f) => ({ ...f, background: { ...f.background, [field]: value } }))
  // Changing state resets the city, since cities are state-specific.
  const setStateField = (value) => change((f) => ({ ...f, personal: { ...f.personal, state: value, city: '' } }))
  const goStep = (s) => { dirty.current = true; setStep(s) }

  function validate(targetStep = step) {
    const e = {}
    if (targetStep === 0 && !form.programme) e.programme = 'Please choose a programme.'
    if (targetStep === 1) {
      if (!form.personal.fullName.trim()) e.fullName = 'Enter your full name.'
      if (!form.personal.dob) e.dob = 'Enter your date of birth.'
      if (!form.personal.phone.trim()) e.phone = 'Enter a phone number.'
    }
    if (targetStep === 2) {
      if (!form.background.education) e.education = 'Select your education level.'
      if (!form.background.experience) e.experience = 'Select your experience level.'
    }
    if (targetStep === 3) {
      if (!form.documents.photo) e.photo = 'Upload a passport photograph.'
      if (!form.documents.idDoc) e.idDoc = 'Upload a valid ID.'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function next() {
    if (!validate()) return
    goStep(Math.min(step + 1, STEPS.length - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function back() {
    setErrors({})
    goStep(Math.max(step - 1, 0))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function goTo(i) {
    if (i < step) { setErrors({}); goStep(i) }
  }

  async function onFile(fieldId, file) {
    if (!file) return
    if (file.size > FILE_CAP) {
      setErrors((e) => ({ ...e, [fieldId]: 'File is too large (max 5 MB). Please compress it.' }))
      return
    }
    setUploading(fieldId)
    const body = new FormData()
    body.append('file', file)
    try {
      const doc = await api(`/applications/current/documents/${fieldId}`, { method: 'POST', form: body })
      setForm((f) => ({ ...f, documents: { ...f.documents, [fieldId]: doc } }))
      setErrors((e) => { const n = { ...e }; delete n[fieldId]; return n })
    } catch (err) {
      setErrors((e) => ({ ...e, [fieldId]: err.message }))
    } finally {
      setUploading(null)
    }
  }

  async function removeFile(fieldId) {
    await api(`/applications/current/documents/${fieldId}`, { method: 'DELETE' }).catch(() => {})
    setForm((f) => { const docs = { ...f.documents }; delete docs[fieldId]; return { ...f, documents: docs } })
  }

  async function handleSubmit() {
    if (!consent) { setErrors({ consent: 'Please accept the declaration to submit.' }); return }
    for (const s of [0, 1, 2, 3]) {
      if (!validate(s)) { setStep(s); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    }
    setErrors({})
    setSubmitting(true)
    try {
      const { documents, ...rest } = form // eslint-disable-line no-unused-vars
      await api('/applications/current', { method: 'PUT', body: { ...rest, step } })
      setSubmitted(await api('/applications/current/submit', { method: 'POST', body: { consent: true } }))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      const details = err.details ?? {}
      setErrors({ ...details, submit: err.message })
      const first = Object.keys(details).map((k) => FIELD_STEP[k]).filter((x) => x != null).sort()[0]
      if (first != null) setStep(first)
    } finally {
      setSubmitting(false)
    }
  }

  async function startNew() {
    setStatus({ loading: true })
    try {
      const app = await api('/applications/new', { method: 'POST' })
      setExisting(null)
      hydrate({ ...app, personal: { fullName: user.fullName, phone: user.phone ?? '', email: user.email } })
      setStatus({ loading: false })
    } catch (err) {
      setStatus({ loading: false, error: err })
    }
  }

  if (status.loading) return <div className="container section"><Loading /></div>
  if (status.error) return <div className="container section"><p className="apply-error">{status.error.message}</p></div>

  if (existing) {
    return (
      <>
        <PageHeader eyebrow="Admissions" title="Your application" />
        <section className="section">
          <div className="container apply-done">
            <h2>You’ve already applied</h2>
            <p>Your application <strong>{existing.reference}</strong> for the {existing.programmeName} was submitted on {date(existing.submittedAt)}. Its status is <strong>{existing.status.replace(/_/g, ' ')}</strong>.</p>
            <div className="apply-done__actions">
              <Button to="/portal">Track in the portal</Button>
              {['declined', 'enrolled', 'admitted', 'waitlisted'].includes(existing.status) && <Button variant="outline" onClick={startNew}>Apply for another programme</Button>}
            </div>
          </div>
        </section>
      </>
    )
  }

  if (submitted) {
    const prog = { name: submitted.programmeName }
    return (
      <>
        <PageHeader eyebrow="Admissions" title="Application submitted" />
        <section className="section">
          <div className="container apply-done">
            <div className="apply-done__icon" aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <h2>Thank you{form.personal.fullName ? `, ${form.personal.fullName.split(' ')[0]}` : ''}!</h2>
            <p>We’ve received your application{prog ? ` for the ${prog.name}` : ''}. Our team will review it and get in touch using the details you provided.</p>
            <div className="apply-done__ref">
              <span>Your reference</span>
              <strong>{submitted.reference}</strong>
            </div>
            <p className="muted">We’ve emailed you a confirmation. You can track your application status in your portal at any time.</p>
            <div className="apply-done__actions">
              <Button to="/portal">Track my application</Button>
              <Button to="/" variant="outline">Back to home</Button>
            </div>
          </div>
        </section>
      </>
    )
  }

  return (
    <>
      <PageHeader eyebrow="Admissions" title="Online application" intro="Complete the steps below. Your progress is saved automatically, so you can return any time." />

      <section className="section">
        <div className="container apply">
          {/* Stepper */}
          <ol className="apply-steps" aria-label="Application progress">
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={`apply-steps__item${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`}
              >
                <button type="button" className="apply-steps__btn" onClick={() => goTo(i)} disabled={i > step}>
                  <span className="apply-steps__num">{i < step ? '✓' : i + 1}</span>
                  <span className="apply-steps__label">{label}</span>
                </button>
              </li>
            ))}
          </ol>

          {status.resumed && (
            <p className="apply-note apply-note--info" role="status">We’ve restored your saved progress. You can continue where you left off.</p>
          )}
          <p className="apply-save-state muted" aria-live="polite">
            {saveState === 'pending' ? 'Saving…' : saveState === 'saved' ? 'All changes saved' : saveState === 'error' ? 'Could not save — check your connection' : 'Your progress saves automatically'}
          </p>

          <div className="apply-panel">
            {/* STEP 0 — Programme */}
            {step === 0 && (
              <fieldset className="apply-fieldset">
                <legend>Which programme are you applying for?</legend>
                <div className="apply-options">
                  {programmes.map((p) => (
                    <label key={p.slug} className={`apply-option${form.programme === p.slug ? ' is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="programme"
                        value={p.slug}
                        checked={form.programme === p.slug}
                        onChange={() => change((f) => ({ ...f, programme: p.slug }))}
                      />
                      <span className="apply-option__tag">{programmeTypes[p.type]}</span>
                      <span className="apply-option__name">{p.name}</span>
                      <span className="apply-option__meta">{p.durationWeeks ? `${p.durationWeeks} weeks · ` : ''}{p.schedule}</span>
                    </label>
                  ))}
                </div>
                {errors.programme && <p className="apply-error">{errors.programme}</p>}
              </fieldset>
            )}

            {/* STEP 1 — Personal */}
            {step === 1 && (
              <div className="apply-form">
                <div className="apply-row">
                  <Field label="Full name" error={errors.fullName} required>
                    <input value={form.personal.fullName} onChange={(e) => setPersonal('fullName', e.target.value)} autoComplete="name" />
                  </Field>
                  <Field label="Date of birth" error={errors.dob} required>
                    <input type="date" value={form.personal.dob} onChange={(e) => setPersonal('dob', e.target.value)} />
                  </Field>
                </div>
                <div className="apply-row">
                  <Field label="Gender">
                    <select value={form.personal.gender} onChange={(e) => setPersonal('gender', e.target.value)}>
                      <option value="">Prefer not to say</option>
                      <option>Female</option>
                      <option>Male</option>
                      <option>Other</option>
                    </select>
                  </Field>
                  <Field label="Phone" error={errors.phone} required>
                    <input type="tel" value={form.personal.phone} onChange={(e) => setPersonal('phone', e.target.value)} autoComplete="tel" />
                  </Field>
                </div>
                <Field label="Email" hint="Your account email — we’ll send updates here.">
                  <input type="email" value={form.personal.email} disabled />
                </Field>
                <Field label="Home address">
                  <input value={form.personal.address} onChange={(e) => setPersonal('address', e.target.value)} autoComplete="street-address" />
                </Field>
                <div className="apply-row">
                  <Field label="State">
                    <select value={form.personal.state} onChange={(e) => setStateField(e.target.value)}>
                      <option value="">Select state…</option>
                      {states.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="City / town" hint={!form.personal.state ? 'Choose a state first' : undefined}>
                    <select value={form.personal.city} onChange={(e) => setPersonal('city', e.target.value)} disabled={!form.personal.state}>
                      <option value="">{form.personal.state ? 'Select city / town…' : 'Select state first'}</option>
                      {lgasFor(form.personal.state).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                </div>
                <h3 className="apply-subhead">Parent, guardian or sponsor</h3>
                <div className="apply-row">
                  <Field label="Name">
                    <input value={form.guardian.name} onChange={(e) => setGuardian('name', e.target.value)} />
                  </Field>
                  <Field label="Phone">
                    <input type="tel" value={form.guardian.phone} onChange={(e) => setGuardian('phone', e.target.value)} />
                  </Field>
                </div>
                <div className="apply-row">
                  <Field label="Relationship" hint="e.g. Parent, Guardian, Employer">
                    <input value={form.guardian.relationship} onChange={(e) => setGuardian('relationship', e.target.value)} />
                  </Field>
                  <Field label="Sponsoring organisation" hint="Only for sponsored cohorts (e.g. SUPA ITF).">
                    <input value={form.guardian.sponsor} onChange={(e) => setGuardian('sponsor', e.target.value)} />
                  </Field>
                </div>
              </div>
            )}

            {/* STEP 2 — Background */}
            {step === 2 && (
              <div className="apply-form">
                <Field label="Highest level of education" error={errors.education} required>
                  <select value={form.background.education} onChange={(e) => setBackground('education', e.target.value)}>
                    <option value="">Select…</option>
                    <option>Primary</option>
                    <option>Secondary / SSCE</option>
                    <option>Diploma / NCE / OND</option>
                    <option>Degree (HND / BSc or higher)</option>
                    <option>Other</option>
                  </select>
                </Field>
                <Field label="Cooking experience" error={errors.experience} required>
                  <select value={form.background.experience} onChange={(e) => setBackground('experience', e.target.value)}>
                    <option value="">Select…</option>
                    <option>Complete beginner</option>
                    <option>Home cook</option>
                    <option>Some professional experience</option>
                    <option>Working in a kitchen</option>
                  </select>
                </Field>
                <Field label="Why do you want to train with us?" hint="Optional — tell us your goals.">
                  <textarea rows="4" value={form.background.goal} onChange={(e) => setBackground('goal', e.target.value)} />
                </Field>
              </div>
            )}

            {/* STEP 3 — Documents */}
            {step === 3 && (
              <div className="apply-form">
                <p className="muted">Upload clear copies. Each file must be under 5&nbsp;MB. Files upload as soon as you choose them.</p>
                {docFields.map((d) => {
                  const file = form.documents[d.id]
                  return (
                    <div key={d.id} className="apply-upload">
                      <div className="apply-upload__head">
                        <span className="apply-upload__label">{d.label}{d.required && <em> *</em>}</span>
                        <span className="apply-upload__hint">{d.hint}</span>
                      </div>
                      {file ? (
                        <div className="apply-file">
                          {file.type?.startsWith('image/') ? (
                            <Thumb fileId={file.id} />
                          ) : (
                            <span className="apply-file__doc" aria-hidden="true">PDF</span>
                          )}
                          <span className="apply-file__name">{file.name}</span>
                          <button type="button" className="apply-file__remove" onClick={() => removeFile(d.id)}>Remove</button>
                        </div>
                      ) : (
                        <label className="apply-dropzone">
                          <input type="file" accept={d.accept} disabled={uploading === d.id} onChange={(e) => onFile(d.id, e.target.files[0])} />
                          <span>{uploading === d.id ? 'Uploading…' : 'Choose file'}</span>
                        </label>
                      )}
                      {errors[d.id] && <p className="apply-error">{errors[d.id]}</p>}
                    </div>
                  )
                })}
              </div>
            )}

            {/* STEP 4 — Review */}
            {step === 4 && (
              <div className="apply-review">
                <ReviewBlock title="Programme" onEdit={() => goStep(0)}>
                  <p>{programmes.find((p) => p.slug === form.programme)?.name || '—'}</p>
                </ReviewBlock>
                <ReviewBlock title="Your details" onEdit={() => goStep(1)}>
                  <dl className="apply-review__dl">
                    <div><dt>Name</dt><dd>{form.personal.fullName || '—'}</dd></div>
                    <div><dt>Date of birth</dt><dd>{form.personal.dob || '—'}</dd></div>
                    <div><dt>Phone</dt><dd>{form.personal.phone || '—'}</dd></div>
                    <div><dt>Email</dt><dd>{form.personal.email || '—'}</dd></div>
                    <div><dt>Address</dt><dd>{[form.personal.address, form.personal.city, form.personal.state].filter(Boolean).join(', ') || '—'}</dd></div>
                    <div><dt>Guardian / sponsor</dt><dd>{[form.guardian.name, form.guardian.phone, form.guardian.relationship, form.guardian.sponsor].filter(Boolean).join(' · ') || '—'}</dd></div>
                  </dl>
                </ReviewBlock>
                <ReviewBlock title="Background" onEdit={() => goStep(2)}>
                  <dl className="apply-review__dl">
                    <div><dt>Education</dt><dd>{form.background.education || '—'}</dd></div>
                    <div><dt>Experience</dt><dd>{form.background.experience || '—'}</dd></div>
                    {form.background.goal && <div><dt>Goal</dt><dd>{form.background.goal}</dd></div>}
                  </dl>
                </ReviewBlock>
                <ReviewBlock title="Documents" onEdit={() => goStep(3)}>
                  <ul className="apply-review__files">
                    {docFields.map((d) => (
                      <li key={d.id}>{d.label}: <strong>{form.documents[d.id]?.name || (d.required ? 'Missing' : 'Not provided')}</strong></li>
                    ))}
                  </ul>
                </ReviewBlock>

                <label className="apply-consent">
                  <input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErrors((x) => ({ ...x, consent: undefined })) }} />
                  <span>I confirm the information above is accurate, and I agree that the academy may store and use my details as described in the <Link to="/legal/privacy">privacy policy</Link>.</span>
                </label>
                {errors.consent && <p className="apply-error">{errors.consent}</p>}
                {errors.submit && <p className="apply-error" role="alert">{errors.submit}</p>}
              </div>
            )}
          </div>

          {/* Nav */}
          <div className="apply-nav">
            {step > 0
              ? <Button variant="outline" onClick={back}>Back</Button>
              : <Button variant="outline" onClick={() => navigate('/admissions')}>Cancel</Button>}
            {step < STEPS.length - 1
              ? <Button onClick={next}>Continue</Button>
              : <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit application'}</Button>}
          </div>
        </div>
      </section>
    </>
  )
}

function Field({ label, hint, error, required, children }) {
  return (
    <label className="apply-field">
      <span className="apply-field__label">{label}{required && <em> *</em>}</span>
      {children}
      {hint && !error && <span className="apply-field__hint">{hint}</span>}
      {error && <span className="apply-error">{error}</span>}
    </label>
  )
}

function Thumb({ fileId }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let u
    fetchImageUrl(`/applications/documents/${fileId}`).then((x) => { u = x; setUrl(x) })
    return () => u && URL.revokeObjectURL(u)
  }, [fileId])
  return url ? <img src={url} alt="" className="apply-file__thumb" /> : <span className="apply-file__doc" aria-hidden="true">IMG</span>
}

function ReviewBlock({ title, onEdit, children }) {
  return (
    <div className="apply-review__block">
      <div className="apply-review__head">
        <h3>{title}</h3>
        <button type="button" onClick={onEdit}>Edit</button>
      </div>
      {children}
    </div>
  )
}
