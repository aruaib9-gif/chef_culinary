import { motion, useReducedMotion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import Reveal from '../components/ui/Reveal.jsx'
import './Admissions.css'

const EASE = [0.22, 1, 0.36, 1]

const requirements = [
  'Open to beginners and working cooks alike — no prior experience required.',
  'A genuine passion for food and a willingness to learn.',
  'Availability for practical classes on Monday, Wednesday & Friday.',
  'A valid means of identification and recent passport photographs.',
]

const documents = [
  'Your completed online application',
  'A valid ID (NIN, voter’s card, driver’s licence or passport)',
  'Two recent passport photographs',
  'A sponsorship or organisation letter (for sponsored cohorts)',
]

const steps = [
  { step: '01', title: 'Choose your programme', body: 'Pick the pathway that matches your goals — full-time, sponsored cohort or a short course.' },
  { step: '02', title: 'Apply online', body: 'Complete the application form and upload your documents. It only takes a few minutes.' },
  { step: '03', title: 'We review & reach out', body: 'Our team reviews your application and contacts you with the next steps and fees.' },
  { step: '04', title: 'Confirm your place', body: 'Secure your spot, complete enrolment and get ready for your first class.' },
]

const faqs = [
  { q: 'Do I need prior experience to apply?', a: 'No. Our programmes start from the fundamentals, so complete beginners are welcome alongside those sharpening existing skills.' },
  { q: 'What documents do I need?', a: 'A completed application, a valid means of ID, recent passport photographs, and — for sponsored trainees — a letter from your organisation or scheme.' },
  { q: 'How much are the fees?', a: 'Fees vary by programme and are shared on request. Send an enquiry or start your application and our team will send you the details.' },
  { q: 'Are payment arrangements available?', a: 'Flexible payment arrangements may be available depending on the programme. Ask our team when you apply.' },
  { q: 'When can I start?', a: 'New cohorts run throughout the year with classes on Monday, Wednesday and Friday. Contact us for the next available start date.' },
  { q: 'Can my employer or scheme sponsor me?', a: 'Yes. We run dedicated sponsored cohorts for organisations and schemes such as SUPA ITF. Reach out and we’ll set it up.' },
]

export default function Admissions() {
  const reduce = useReducedMotion()

  const gridContainer = reduce
    ? {}
    : { hidden: {}, show: { transition: { staggerChildren: 0.1 } } }
  const gridItem = reduce
    ? {}
    : { hidden: { opacity: 0, y: 26, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE } } }

  return (
    <>
      <PageHeader
        eyebrow="Admissions"
        title="How to apply"
        intro="Joining The Chefs Culinary Academy is simple. Here's who can apply, how it works, and what to expect."
      />

      {/* Steps */}
      <section className="section">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">The process</span>
            <h2>From application to first class</h2>
            <p>Four straightforward steps to your place in the kitchen.</p>
          </Reveal>
          <motion.ol
            className="adm-steps"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-60px' }}
          >
            {steps.map((s) => (
              <motion.li key={s.step} className="adm-step" variants={gridItem}>
                <span className="adm-step__num">{s.step}</span>
                <h3>{s.title}</h3>
                <p className="muted">{s.body}</p>
              </motion.li>
            ))}
          </motion.ol>
        </div>
      </section>

      {/* Requirements & documents */}
      <section className="section section--warm">
        <div className="container adm-two">
          <Reveal className="adm-panel">
            <span className="eyebrow">Entry requirements</span>
            <h2>Who can apply</h2>
            <ul className="adm-list">
              {requirements.map((r) => (
                <li key={r}>
                  <span className="adm-list__check" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  {r}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal className="adm-panel" delay={0.1}>
            <span className="eyebrow">Before you apply</span>
            <h2>Documents to prepare</h2>
            <ul className="adm-list">
              {documents.map((d) => (
                <li key={d}>
                  <span className="adm-list__check" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  {d}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* Fees & sponsorships */}
      <section className="section">
        <div className="container adm-two">
          <Reveal className="adm-card">
            <h2>Fees &amp; payment</h2>
            <p>
              Fees vary by programme and are shared on request. For the professional programme, the
              fee covers your handbook and workbook, uniform, class assignments and project work.
            </p>
            <p className="muted">Flexible payment arrangements may be available — ask our team when you apply.</p>
            <Button to="/contact" variant="outline">Request fees</Button>
          </Reveal>
          <Reveal className="adm-card adm-card--brand" delay={0.1}>
            <h2>Scholarships &amp; sponsorships</h2>
            <p>
              We run dedicated sponsored cohorts for organisations and training schemes such as
              SUPA ITF. Employers and schemes can sponsor trainees through our programmes.
            </p>
            <p>Interested in sponsoring a cohort or applying as a sponsored trainee?</p>
            <Button to="/contact" variant="light">Talk to us</Button>
          </Reveal>
        </div>
      </section>

      {/* Intakes */}
      <section className="section section--warm">
        <div className="container">
          <Reveal className="adm-intake">
            <div className="adm-intake__icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
            </div>
            <div>
              <h2>Intakes &amp; schedule</h2>
              <p>
                New cohorts run throughout the year, with classes held three days a week —
                Monday, Wednesday &amp; Friday. Contact us for the next available start date.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section className="section">
        <div className="container adm-faq">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">FAQ</span>
            <h2>Admissions questions</h2>
            <p>Still unsure about something? Reach out any time.</p>
          </Reveal>
          <div className="adm-faq__list">
            {faqs.map((f, i) => (
              <Reveal as="details" key={f.q} className="adm-faq__item" delay={i * 0.05} {...(i === 0 ? { open: true } : {})}>
                <summary>
                  {f.q}
                  <span className="adm-faq__icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                  </span>
                </summary>
                <p>{f.a}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section">
        <Reveal className="container adm-cta">
          <h2>Ready to apply?</h2>
          <p>Start your application today — it only takes a few minutes.</p>
          <div className="adm-cta__actions">
            <Button to="/admissions/apply">Start application</Button>
            <Button to="/programmes" variant="light">Browse programmes</Button>
          </div>
        </Reveal>
      </section>
    </>
  )
}
