'use client'
import { Link, NavLink, useNavigate } from '@/lib/router'
import { useAuth } from '../../lib/auth.jsx'
import { Notice } from '../portal/ui.jsx'
import './PortalLayout.css'

const studentNav = [
  { to: '/portal', label: 'Dashboard', end: true },
  { to: '/portal/results', label: 'Results' },
  { to: '/portal/payments', label: 'Payments' },
  { to: '/portal/timetable', label: 'Timetable' },
  { to: '/portal/course-outline', label: 'Course outline' },
  { to: '/portal/materials', label: 'Materials' },
  { to: '/portal/assignments', label: 'Assignments' },
  { to: '/portal/notices', label: 'Notices' },
  { to: '/portal/certificates', label: 'Certificates' },
  { to: '/portal/requests', label: 'Requests & feedback' },
  { to: '/portal/profile', label: 'Profile' },
]

const applicantNav = [
  { to: '/portal', label: 'My application', end: true },
  { to: '/admissions/apply', label: 'Application form' },
  { to: '/portal/profile', label: 'Account' },
]

export default function PortalLayout({ children }) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const nav = user?.role === 'student' ? studentNav : applicantNav

  async function handleLogout() {
    await logout()
    navigate('/portal/login', { replace: true })
  }

  return (
    <div className="portal">
      <header className="portal__bar">
        <div className="container portal__bar-inner">
          <Link to="/portal" className="portal__brand">{user?.role === 'student' ? 'Student Portal' : 'Applicant Portal'}</Link>
          <div className="portal__account">
            {user?.fullName && <span className="portal__user">Hi, {user.fullName.split(' ')[0]}</span>}
            <button type="button" className="portal__logout" onClick={handleLogout}>Sign out</button>
            <Link to="/" className="portal__back">Back to website</Link>
          </div>
        </div>
      </header>
      <nav className="portal__nav" aria-label="Portal">
        <div className="container portal__nav-inner">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>
          ))}
        </div>
      </nav>
      <main className="portal__main container" id="main">
        {user?.mustChangePassword && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Notice tone="warn"><span>You signed in with a temporary password. <Link to="/portal/profile#security">Choose a new password</Link> now.</span></Notice>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
