'use client'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from '@/lib/router'
import { adminNav } from '../nav.js'
import { useAuth } from '../lib/auth.jsx'
import { Notice } from './ui.jsx'
const logo = '/images/logo-small.jpg'

const ROLE_LABELS = { super_admin: 'Super admin', staff: 'Staff' }

export default function AdminLayout({ children }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const { user, isSuper } = useAuth()

  useEffect(() => setOpen(false), [pathname])

  return (
    <div className="admin">
      <header className="admin__topbar">
        <div className="admin__topbar-left">
          <button className="admin__menu-btn" aria-expanded={open} aria-controls="admin-nav" onClick={() => setOpen((o) => !o)}>
            <span className="visually-hidden">{open ? 'Close menu' : 'Open menu'}</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
          <Link to="/" className="admin__brand">
            <img src={logo} alt="" className="admin__logo" width="40" height="40" />
            <span className="admin__brand-text">
              <span className="admin__brand-name">
                <span className="admin__brand-full">The Chefs Culinary Academy</span>
                <span className="admin__brand-short">Chefs Academy</span>
              </span>
              <span className="admin__brand-sub">Admin portal</span>
            </span>
          </Link>
        </div>
        <AccountMenu user={user} isSuper={isSuper} />
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
          {user.mustChangePassword && <Notice tone="warn">You are using a temporary password. <Link to="/settings?tab=account">Change it now</Link>.</Notice>}
          {children}
        </main>
      </div>
    </div>
  )
}

// Name to show: the person's name, unless it's empty or just a role label (e.g. the seeded "Super Admin").
function displayName(user) {
  const name = (user.fullName ?? '').trim()
  const isGeneric = !name || Object.values(ROLE_LABELS).some((r) => r.toLowerCase() === name.toLowerCase())
  return isGeneric ? user.email : name
}

function initials(text) {
  const parts = text.split('@')[0].split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function AccountMenu({ user, isSuper }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { pathname } = useLocation()
  const name = displayName(user)

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function signOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="admin__account" ref={ref}>
      <button type="button" className="admin__account-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="admin__avatar" aria-hidden="true">{initials(name)}</span>
        <span className="admin__account-text">
          <span className="admin__account-name">{name}</span>
          <span className={`admin__role admin__role--${isSuper ? 'super' : 'staff'}`}>{ROLE_LABELS[user.role] ?? user.role}</span>
        </span>
        <svg className="admin__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="admin__account-menu" role="menu">
          <div className="admin__account-head">
            <span className="admin__account-menu-name" title={name}>{name}</span>
            {name !== user.email && <span className="a-meta">{user.email}</span>}
          </div>
          <Link role="menuitem" to="/settings?tab=account">My account &amp; password</Link>
          {isSuper && <Link role="menuitem" to="/settings?tab=users">Staff users</Link>}
          <button role="menuitem" type="button" onClick={signOut}>Sign out</button>
        </div>
      )}
    </div>
  )
}
