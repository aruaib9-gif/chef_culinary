import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { site } from '@cca/shared/site'
import { mainNav } from '../../nav.js'
import Button from '../ui/Button.jsx'
import { useAuth } from '../../lib/auth.jsx'
import logo from '../../assets/chef_logo.jpg'
import './Header.css'

export default function Header() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const { user } = useAuth()

  useEffect(() => setOpen(false), [pathname])

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="site-header__brand">
          <img className="site-header__logo" src={logo} alt="" aria-hidden="true" />
          <span>{site.name}</span>
        </Link>

        <button
          className="site-header__toggle"
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="visually-hidden">{open ? 'Close menu' : 'Open menu'}</span>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>

        <nav id="site-nav" className="site-nav" data-open={open} aria-label="Main">
          <ul className="site-nav__links">
            {mainNav.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end}>{item.label}</NavLink>
              </li>
            ))}
          </ul>
          <div className="site-nav__actions">
            {user
              ? <Button to="/portal" variant="outline">My portal</Button>
              : <Button to="/portal/login" variant="outline">Student login</Button>}
            <Button to="/admissions/apply">Apply now</Button>
          </div>
        </nav>
      </div>
    </header>
  )
}
