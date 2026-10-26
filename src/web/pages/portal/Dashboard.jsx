'use client'
import { Link } from '@/lib/router'
import { useAuth } from '../../lib/auth.jsx'
import { useApi } from '../../lib/useApi.js'
import { fetchFile } from '../../lib/api.js'
import { money, date, DAYS } from '../../lib/format.js'
import { PageHead, Loading, ErrorBox, Badge, Stat, Notice } from '../../components/portal/ui.jsx'

export default function Dashboard() {
  const { user } = useAuth()
  return user?.role === 'student' ? <StudentDashboard /> : <ApplicantDashboard />
}

// ── Enrolled students (spec §8.2) ────────────────────────────────────────────

function StudentDashboard() {
  const { data, error, loading, reload } = useApi('/student/dashboard')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { student, account, latestResult, nextClass, notices, currentWeek, attendance, pendingAssignments, resultsWithheld } = data

  return (
    <div className="portal-page">
      <PageHead
        title={`Welcome back, ${student.firstName}`}
        intro={`${student.programme ?? 'No programme assigned'}${student.cohort ? ` · ${student.cohort}` : ''} · ID ${student.studentNumber}`}
      />

      <div className="portal-grid">
        <Stat label="Current week" value={currentWeek ? `Week ${currentWeek}` : '—'} sub={student.cohortStartsOn ? `Started ${date(student.cohortStartsOn)}` : 'Start date to be confirmed'} />
        <Stat label="Fee balance" value={money(Math.max(0, account.balanceKobo))} sub={account.balanceKobo > 0 ? (account.nextDue ? `Next due ${date(account.nextDue)}` : 'Outstanding') : 'Fully paid'} />
        <Stat
          label="Latest result"
          value={resultsWithheld ? 'Withheld' : latestResult ? `${latestResult.grade} · ${latestResult.total}` : '—'}
          sub={resultsWithheld ? 'Clear your balance to view' : latestResult?.course_name ?? 'No results yet'}
        />
        <Stat
          label="Next class"
          value={nextClass ? `${DAYS[nextClass.dayOfWeek].slice(0, 3)} ${nextClass.startTime}` : '—'}
          sub={nextClass ? `${nextClass.courseName ?? nextClass.title}${nextClass.venue ? ` · ${nextClass.venue}` : ''}` : 'Timetable not published'}
        />
      </div>

      {account.balanceKobo > 0 && (
        <Notice tone="warn">
          <span>You have an outstanding balance of <strong>{money(account.balanceKobo)}</strong>.</span>
          <Link className="portal-link-btn" to="/portal/payments">Pay fees</Link>
        </Notice>
      )}

      <div className="portal-cols">
        <div className="card">
          <h2 className="portal-card-title">Notice board</h2>
          {notices.length ? (
            <ul className="p-list" style={{ marginTop: 'var(--space-3)' }}>
              {notices.map((n) => (
                <li key={n.id}>
                  <div className="p-list-item__title">{n.is_pinned && '📌 '}{n.title}</div>
                  <div className="p-list-item__meta">{date(n.created_at)}</div>
                  <p style={{ marginTop: 'var(--space-1)', whiteSpace: 'pre-line' }}>{n.body.length > 220 ? `${n.body.slice(0, 220)}…` : n.body}</p>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No announcements right now.</p>}
          <p style={{ marginTop: 'var(--space-3)' }}><Link to="/portal/notices">All notices →</Link></p>
        </div>
        <div className="card">
          <h2 className="portal-card-title">Quick links</h2>
          <ul className="portal-links">
            <li><Link to="/portal/results">Results →</Link></li>
            <li><Link to="/portal/payments">Pay fees →</Link></li>
            <li><Link to="/portal/timetable">Timetable →</Link></li>
            <li><Link to="/portal/course-outline">Course outline →</Link></li>
            <li><Link to="/portal/materials">Materials →</Link></li>
            <li><Link to="/portal/assignments">Assignments{pendingAssignments ? ` (${pendingAssignments} due)` : ''} →</Link></li>
            <li><Link to="/portal/certificates">Certificates →</Link></li>
          </ul>
          {attendance && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <div className="card__label">Attendance {attendance.rate != null ? `· ${attendance.rate}%` : ''}</div>
              <div className="p-progress" style={{ marginTop: 'var(--space-2)' }}><span style={{ width: `${attendance.rate ?? 0}%` }} /></div>
              <div className="p-stat-sub">{attendance.attended} of {attendance.total} sessions attended</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Applicants: application tracking (spec §7) ───────────────────────────────

const STATUS_TEXT = {
  draft: 'Not submitted yet — finish and submit your application.',
  received: 'We have received your application and will review it shortly.',
  under_review: 'Our admissions team is reviewing your application.',
  admitted: 'Congratulations! You have been offered a place. Your admission letter is below; the academy will complete your enrolment.',
  waitlisted: 'You are on the waiting list. We will contact you as soon as a place opens.',
  declined: 'Unfortunately we could not offer you a place this time. You are welcome to apply for a future intake.',
  enrolled: 'You are enrolled. Sign out and back in to open the full student portal.',
}

function ApplicantDashboard() {
  const { user } = useAuth()
  const { data: apps, error, loading, reload } = useApi('/applications/mine')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const steps = ['received', 'under_review', 'admitted', 'enrolled']

  return (
    <div className="portal-page">
      <PageHead title={`Hello, ${user.fullName.split(' ')[0]}`} intro="Track your application to The Chefs Culinary Academy." />
      {apps.length === 0 ? (
        <div className="card portal-status">
          <div>
            <div className="card__label">No application yet</div>
            <div className="portal-status__prog">Start your online application — it takes about 10 minutes.</div>
          </div>
          <Link className="portal-link-btn" to="/admissions/apply">Start application</Link>
        </div>
      ) : (
        apps.map((app) => {
          const stepIndex = steps.indexOf(app.status)
          return (
            <div key={app.id} className="card" style={{ display: 'grid', gap: 'var(--space-4)' }}>
              <div className="portal-status" style={{ padding: 0, border: 0 }}>
                <div>
                  <div className="card__label">Application {app.reference}</div>
                  <div className="portal-status__prog">{app.programmeName ?? 'Programme not chosen'}</div>
                </div>
                <Badge status={app.status}>{app.status === 'received' ? 'Received' : undefined}</Badge>
              </div>
              <p>{STATUS_TEXT[app.status]}</p>
              {stepIndex >= 0 && (
                <ol className="apply-steps" aria-label="Application progress">
                  {['Received', 'Under review', 'Admitted', 'Enrolled'].map((label, i) => (
                    <li key={label} className={`apply-steps__item${i === stepIndex ? ' is-active' : ''}${i < stepIndex ? ' is-done' : ''}`}>
                      <span className="apply-steps__btn"><span className="apply-steps__num">{i < stepIndex ? '✓' : i + 1}</span><span className="apply-steps__label">{label}</span></span>
                    </li>
                  ))}
                </ol>
              )}
              <div className="p-form__actions">
                {app.status === 'draft' && <Link className="p-btn p-btn--primary" to="/admissions/apply">Continue application</Link>}
                {['admitted', 'enrolled'].includes(app.status) && (
                  <button type="button" className="p-btn" onClick={() => fetchFile(`/applications/${app.id}/admission-letter.pdf`)}>Download admission letter</button>
                )}
                {app.submittedAt && <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>Submitted {date(app.submittedAt)}</span>}
              </div>
            </div>
          )
        })
      )}
      <div className="card portal-cta-card">
        <div>
          <h2 className="portal-card-title">Questions about your application?</h2>
          <p className="muted">Call 08117248206 or send us a message — we’re happy to help.</p>
        </div>
        <Link className="portal-link-btn" to="/contact">Contact admissions</Link>
      </div>
    </div>
  )
}
