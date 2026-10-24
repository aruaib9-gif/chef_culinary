import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { adminNav } from '../nav.js'
import { useAuth } from '../lib/auth.jsx'
import { Notice } from './ui.jsx'

export default function AdminLayout() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, isSuper, logout } = useAuth()

  useEffect(() => setOpen(false), [pathname])

  async function signOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="admin">
      <header className="admin__topbar">
        <Link to="/" className="admin__brand" style={{ color: '#fff', textDecoration: 'none' }}>CCA Admin</Link>
        <div className="admin__user">
          <span className="muted" style={{ color: 'rgb(255 255 255 / .75)' }}>{user.fullName || user.email} · {isSuper ? 'Super admin' : 'Staff'}</span>
          <button type="button" onClick={signOut}>Sign out</button>
          <button className="admin__menu-btn" aria-expanded={open} aria-controls="admin-nav" onClick={() => setOpen((o) => !o)}>Menu</button>
        </div>
      </header>
      <div className="admin__body">
        <nav id="admin-nav" className="admin__sidebar" data-open={open} aria-label="Admin">
          <ul>
            {adminNav.filter((item) => isSuper || !item.superOnly).map((item) =>
              item.group ? (
                <li key={item.group} className="admin__nav-group">{item.group}</li>
              ) : (
                <li key={item.to}><NavLink to={item.to} end={item.end}>{item.label}</NavLink></li>
              ),
            )}
          </ul>
        </nav>
        <main className="admin__main" id="main">
          {user.mustChangePassword && <Notice tone="warn"><span>You are using a temporary password. <Link to="/settings?tab=account">Change it now</Link>.</span></Notice>}
          <Outlet />
        </main>
      </div>
    </div>
  )
}
