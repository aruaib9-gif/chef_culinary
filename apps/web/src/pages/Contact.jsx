import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { site, whatsappUrl } from '@cca/shared/site'
import { useProgrammes } from '../lib/useProgrammes.js'
import { api } from '../lib/api.js'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import Reveal from '../components/ui/Reveal.jsx'
import '../components/Form.css'
import './Contact.css'

const EASE = [0.22, 1, 0.36, 1]

const socials = [
  { key: 'instagram', label: 'Instagram', icon: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg> },
  { key: 'facebook', label: 'Facebook', icon: <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M22 12a10 10 0 10-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0022 12z" /></svg> },
  { key: 'tiktok', label: 'TikTok', icon: <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16.5 3c.3 2.1 1.5 3.6 3.5 3.8v2.5c-1.3.1-2.5-.3-3.6-1v5.9c0 3.4-2.6 5.8-5.9 5.4-2.6-.3-4.5-2.5-4.5-5 0-2.9 2.6-5.1 5.5-4.6v2.6c-.4-.1-.9-.2-1.3-.1-1.1.2-1.9 1.1-1.8 2.3.1 1.1 1 2 2.1 2 1.2 0 2.1-.9 2.1-2.2V3h3.4z" /></svg> },
].filter((s) => site.social[s.key])

const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(site.address)}&output=embed`

export default function Contact() {
  const { programmes } = useProgrammes()
  const reduce = useReducedMotion()
  const [status, setStatus] = useState({ state: 'idle' })

  async function handleSubmit(e) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const body = Object.fromEntries(form)
    body.consent = form.get('consent') === 'on'
    setStatus({ state: 'sending' })
    try {
      await api('/leads', { method: 'POST', body })
      setStatus({ state: 'sent' })
      e.target.reset()
    } catch (err) {
      setStatus({ state: 'error', message: err.message })
    }
  }

  const quick = [
    { label: 'Call us', value: site.phone, href: `tel:${site.phone}`, icon: <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3.1-8.7A2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.3 1.8.6 2.6a2 2 0 01-.5 2.1L10 9.6a16 16 0 006 6l1.2-1.2a2 2 0 012.1-.5c.8.3 1.7.5 2.6.6a2 2 0 011.7 2z" /> },
    { label: 'WhatsApp', value: 'Chat with us', href: whatsappUrl, external: true, icon: <path d="M21 11.5a8.5 8.5 0 01-12.6 7.4L3 21l2.2-5.3A8.5 8.5 0 1121 11.5z" /> },
    { label: 'Email us', value: site.emails[0], href: `mailto:${site.emails[0]}`, icon: <path d="M4 4h16v16H4zM4 7l8 6 8-6" /> },
  ]

  const gridContainer = reduce ? {} : { hidden: {}, show: { transition: { staggerChildren: 0.1 } } }
  const gridItem = reduce ? {} : { hidden: { opacity: 0, y: 24, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE } } }

  return (
    <>
      <PageHeader
        eyebrow="Contact"
        title="Get in touch"
        intro="Whether you're ready to apply or just have a question, we'd love to hear from you."
      />

      {/* Quick actions */}
      <section className="section">
        <motion.div
          className="container contact-quick"
          variants={gridContainer}
          initial={reduce ? false : 'hidden'}
          whileInView={reduce ? undefined : 'show'}
          viewport={{ once: true, margin: '-60px' }}
        >
          {quick.map((q) => (
            <motion.a
              key={q.label}
              className="contact-quick__card"
              href={q.href}
              variants={gridItem}
              {...(q.external ? { target: '_blank', rel: 'noreferrer' } : {})}
            >
              <span className="contact-quick__icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{q.icon}</svg>
              </span>
              <span className="contact-quick__label">{q.label}</span>
              <span className="contact-quick__value">{q.value}</span>
            </motion.a>
          ))}
        </motion.div>
      </section>

      {/* Form + info */}
      <section className="section">
        <div className="container contact-grid">
          <Reveal className="contact-card">
            <h2>Send an enquiry</h2>
            <p className="muted">Tell us a little about you and we'll get back to you shortly.</p>
            <form className="form" onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="name">Full name</label>
                <input id="name" name="name" required autoComplete="name" />
              </div>
              <div className="field">
                <label htmlFor="phone">Phone</label>
                <input id="phone" name="phone" type="tel" required autoComplete="tel" />
              </div>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" autoComplete="email" />
              </div>
              <div className="field">
                <label htmlFor="programmeInterest">Programme of interest</label>
                <select id="programmeInterest" name="programmeInterest">
                  <option value="">Not sure yet</option>
                  {programmes.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="heardAbout">How did you hear about us?</label>
                <input id="heardAbout" name="heardAbout" />
              </div>
              <div className="field">
                <label htmlFor="message">Message</label>
                <textarea id="message" name="message" rows="4" />
              </div>
              <label className="consent">
                <input type="checkbox" name="consent" required />
                <span>
                  I agree that the academy may store my details and contact me, as described in the{' '}
                  <Link to="/legal/privacy">privacy policy</Link>.
                </span>
              </label>
              {status.state === 'sent' && (
                <p className="form-status form-status--success" role="status">Thank you — we'll be in touch shortly.</p>
              )}
              {status.state === 'error' && (
                <p className="form-status form-status--error" role="alert">{status.message}</p>
              )}
              <Button type="submit" disabled={status.state === 'sending'}>
                {status.state === 'sending' ? 'Sending…' : 'Send enquiry'}
              </Button>
            </form>
          </Reveal>

          <Reveal className="contact-info" delay={0.1}>
            <h2>Visit or call</h2>
            <ul className="contact-info__list">
              <li>
                <span className="contact-info__icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c4-4.5 6-8 6-11a6 6 0 10-12 0c0 3 2 6.5 6 11z" /><circle cx="12" cy="11" r="2.5" /></svg>
                </span>
                <div>
                  <strong>Address</strong>
                  <span>{site.address}</span>
                </div>
              </li>
              <li>
                <span className="contact-info__icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 3h3l1.5 4.5-2 1.5a12 12 0 006 6l1.5-2 4.5 1.5v3a2 2 0 01-2 2A16 16 0 014.5 5a2 2 0 012-2z" /></svg>
                </span>
                <div>
                  <strong>Phone</strong>
                  <a href={`tel:${site.phone}`}>{site.phone}</a>
                </div>
              </li>
              <li>
                <span className="contact-info__icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
                </span>
                <div>
                  <strong>Email</strong>
                  {site.emails.map((email) => <a key={email} href={`mailto:${email}`}>{email}</a>)}
                </div>
              </li>
              <li>
                <span className="contact-info__icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
                </span>
                <div>
                  <strong>Class days</strong>
                  <span>Monday, Wednesday &amp; Friday</span>
                </div>
              </li>
            </ul>

            <a className="contact-info__whatsapp" href={whatsappUrl} target="_blank" rel="noreferrer">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.5 8.5 0 01-12.6 7.4L3 21l2.2-5.3A8.5 8.5 0 1121 11.5z" /></svg>
              Message us on WhatsApp
            </a>

            {socials.length > 0 && (
              <div className="contact-info__socials">
                {socials.map((s) => (
                  <a key={s.key} href={site.social[s.key]} target="_blank" rel="noreferrer" aria-label={s.label} className="contact-info__social">
                    {s.icon}
                  </a>
                ))}
              </div>
            )}
          </Reveal>
        </div>
      </section>

      {/* Map */}
      <section className="section">
        <div className="container">
          <Reveal className="contact-map">
            <iframe
              title="The Chefs Culinary Academy location"
              src={mapSrc}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </Reveal>
        </div>
      </section>
    </>
  )
}
