'use client'
import { useParams } from '@/lib/router'
import { programmeTypes } from '@cca/shared/programmes'
import { getCourse } from '@cca/shared/courses'
import { formatFee } from '@cca/shared/format'
import { useProgrammes } from '../lib/useProgrammes.js'
import { date } from '../lib/format.js'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import { Loading } from '../components/portal/ui.jsx'
import NotFound from './NotFound.jsx'

// Programme page fields (spec §5.1). Content is admin-editable via the API.
export default function ProgrammeDetail() {
  const { slug } = useParams()
  const { programmes, loaded } = useProgrammes()
  const programme = programmes.find((p) => p.slug === slug)
  if (!programme) return loaded ? <NotFound /> : <div className="container section"><Loading /></div>

  const courses = programme.courseDetails ?? programme.courses.map(getCourse).filter(Boolean)
  const sections = [
    ['About the programme', programme.description],
    ['Entry requirements', programme.entryRequirements],
    ['Curriculum overview', programme.curriculum],
    ['Learning outcomes', programme.outcomes],
    ['Career opportunities', programme.careers],
  ].filter(([, v]) => v)

  return (
    <>
      <PageHeader eyebrow={programmeTypes[programme.type]} title={programme.name} intro={programme.summary} />
      <section className="section">
        <div className="container stack">
          <dl className="grid">
            <div><dt className="muted">Duration</dt><dd>{programme.durationWeeks ? `${programme.durationWeeks} weeks` : '—'}</dd></div>
            <div><dt className="muted">Schedule</dt><dd>{programme.schedule ?? '—'}</dd></div>
            <div><dt className="muted">Fee</dt><dd>{formatFee(programme.fee)}</dd></div>
            {programme.intakeDates && <div><dt className="muted">Intakes</dt><dd>{programme.intakeDates}</dd></div>}
            {programme.applicationDeadline && <div><dt className="muted">Application deadline</dt><dd>{date(programme.applicationDeadline)}</dd></div>}
            {programme.certificateAwarded && <div><dt className="muted">Certificate awarded</dt><dd>{programme.certificateAwarded}</dd></div>}
          </dl>

          {programme.instalmentPlan?.length > 0 && programme.fee != null && (
            <>
              <h2>Instalment plan</h2>
              <ul>{programme.instalmentPlan.map((i) => <li key={i.label}>{i.label}: {i.percent}% ({formatFee(Math.round((programme.fee * i.percent) / 100))}){i.dueWeeks ? `, due in week ${i.dueWeeks}` : ', due at enrolment'}</li>)}</ul>
            </>
          )}

          {programme.feeCovers?.length > 0 && (
            <>
              <h2>What the fee covers</h2>
              <ul>{programme.feeCovers.map((item) => <li key={item}>{item}</li>)}</ul>
            </>
          )}

          {sections.map(([title, body]) => (
            <div key={title} className="stack">
              <h2>{title}</h2>
              <p style={{ whiteSpace: 'pre-line' }}>{body}</p>
            </div>
          ))}

          <h2>Courses</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Course</th><th>Type</th></tr></thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id}><td>{c.name}</td><td>{c.type}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            <Button to={`/admissions/apply?programme=${programme.slug}`}>Apply now</Button>
            <Button to="/contact" variant="outline">Enquire</Button>
          </div>
        </div>
      </section>
    </>
  )
}
