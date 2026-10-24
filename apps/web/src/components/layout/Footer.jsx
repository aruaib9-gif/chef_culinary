import { Link } from 'react-router-dom'
import { site } from '@cca/shared/site'
import { mainNav, legalNav } from '../../nav.js'
import Button from '../ui/Button.jsx'
import logo from '../../assets/chef_logo.jpg'
import './Footer.css'

const socialLinks = [
  {
    name: 'Instagram',
    key: 'instagram',
    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>,
  },
  {
    name: 'Facebook',
    key: 'facebook',
    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M22 12a10 10 0 10-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0022 12z" /></svg>,
  },
  {
    name: 'TikTok',
    key: 'tiktok',
    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16.5 3c.3 2.1 1.5 3.6 3.5 3.8v2.5c-1.3.1-2.5-.3-3.6-1v5.9c0 3.4-2.6 5.8-5.9 5.4-2.6-.3-4.5-2.5-4.5-5 0-2.9 2.6-5.1 5.5-4.6v2.6c-.4-.1-.9-.2-1.3-.1-1.1.2-1.9 1.1-1.8 2.3.1 1.1 1 2 2.1 2 1.2 0 2.1-.9 2.1-2.2V3h3.4z" /></svg>,
  },
]

export default function Footer() {
  const socials = socialLinks.filter((s) => site.social[s.key])

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__grid">
          <div>
            <img className="site-footer__logo" src={logo} alt={site.name} />
            <h2>{site.name}</h2>
            <address style={{ fontStyle: 'normal' }}>
              {site.address}
              <br />
              <a href={`tel:${site.phone}`}>{site.phone}</a>
              {site.emails.map((email) => (
                <span key={email}>
                  <br />
                  <a href={`mailto:${email}`}>{email}</a>
                </span>
              ))}
            </address>
          </div>

          <nav aria-label="Footer">
            <h2>Explore</h2>
            <ul>
              {mainNav.map((item) => (
                <li key={item.to}><Link to={item.to}>{item.label}</Link></li>
              ))}
            </ul>
          </nav>

          <div>
            <h2>Legal</h2>
            <ul>
              {legalNav.map((item) => (
                <li key={item.to}><Link to={item.to}>{item.label}</Link></li>
              ))}
              <li><Link to="/verify">Verify a certificate</Link></li>
            </ul>
          </div>

          <div>
            <h2>Newsletter</h2>
            {/* TODO: POST to /api/leads with source "newsletter" + consent checkbox */}
            <form className="newsletter" onSubmit={(e) => e.preventDefault()}>
              <label htmlFor="newsletter-email" className="visually-hidden">Email address</label>
              <input id="newsletter-email" type="email" placeholder="Your email" required />
              <Button type="submit">Subscribe</Button>
            </form>
            {socials.length > 0 && (
              <div className="site-footer__socials">
                {socials.map((s) => (
                  <a
                    key={s.key}
                    className="site-footer__social"
                    href={site.social[s.key]}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={s.name}
                  >
                    {s.icon}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="site-footer__bottom">
          © {new Date().getFullYear()} {site.legalName}. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
