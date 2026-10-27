'use client'
import { motion, useReducedMotion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import Reveal from '../components/ui/Reveal.jsx'
import { Link } from '@/lib/router'
import { formatFee, feeBreakdown } from '@cca/shared/format'
import { useProgrammes } from '../lib/useProgrammes.js'
import './Admissions.css'

const EASE = [0.22, 1, 0.36, 1]

const requirements = [
  'Minimum age of 16 (applicants under 18 need parental or guardian consent)',
  'Basic ability to read, write and understand instructional materials',
  'No prior cooking experience — beginners are welcome',
  'Registration fee of ₦15,000',
]

const documents = [
  'Two (2) passport photographs',
  'A written statement of purpose or application letter',
  'Your previous educational qualification',
  'A recent Hepatitis B test result',
]

const steps = [
  { step: '01', title: 'Get the application form', body: 'Apply online, collect the official form at our campus, or request a digital copy by WhatsApp or email.' },
  { step: '02', title: 'Consultation', body: 'Book a brief interview and facility tour with our admissions team to choose the right course.' },
  { step: '03', title: 'Register', body: 'Submit your completed form, the ₦15,000 registration fee and your documents.' },
  { step: '04', title: 'Orientation', body: 'Start at the next intake with facility induction, food safety and equipment familiarisation.' },
]

const feeNotes = [
  'Registration fee: ₦15,000.',
  'VAT of 7.5% applies to all course fees.',
  'Course fees cover your school uniform, student handbook and learning materials for the entire programme.',
  'Instalment plans are available to indigenous students only. Instalments not paid on the due date attract 10% interest.',
]

const faqs = [
  { q: 'Do I need any cooking experience to enrol?', a: 'No. Our programmes are open to beginners and to those who want to improve their existing skills, taking you from foundational basics to professional mastery.' },
  { q: 'What do I need to apply?', a: 'Two passport photographs, a written statement of purpose or application letter, your previous educational qualification, a recent Hepatitis B test result and the ₦15,000 registration fee.' },
  { q: 'How much do the courses cost?', a: 'Total fees, including VAT and registration, range from ₦122,500 for the Spice and Herbs Class to ₦1,681,250 for the Diploma in Culinary Arts. The fee table on this page shows each total including VAT and registration.' },
  { q: 'Is VAT included in the fees?', a: 'Yes. The total fee for each programme includes 7.5% VAT on tuition and the ₦15,000 registration fee. The fee table shows the breakdown.' },
  { q: 'Do you accept instalment payments?', a: 'An instalment plan is available to indigenous students only; it is not available to international students. Any instalment not paid on its due date attracts 10 percent interest.' },
  { q: 'Can I pay now and resume later?', a: 'Yes. You can secure your admission, pay your tuition and resume later, but not later than the next intake.' },
  { q: 'Can I work and do a programme with you?', a: 'Our classes run in the morning only, on Monday, Wednesday and Friday, so many students fit them around afternoon or evening work.' },
  { q: 'Will I receive a certificate?', a: 'Yes. On successful completion of your programme and final assessments you receive a professional certificate. The Diploma programme leads to a diploma qualification.' },
  { q: 'Do you help graduates find jobs?', a: 'We go the extra mile to secure jobs for our students, and all alumni receive our job opportunity alerts.' },
  { q: 'Can I learn pastry or baking without a full culinary course?', a: 'Yes. Pastry and Mixology and Cake Crafting and Design are standalone 12-week courses.' },
  { q: 'Do you have programmes for children?', a: 'Yes. Our Kitchen Bootcamp for Kids is a 1-month programme for young children during the long summer holiday.' },
]

export default function Admissions() {
  const reduce = useReducedMotion()
  const { programmes } = useProgrammes()

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
        intro="Joining The Chefs Culinary Academy is simple. Here's who can apply, what it costs, and what to expect."
      />

      {/* Steps */}
      <section className="section">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">The process</span>
            <h2>From application to first class</h2>
            <p>Four straightforward steps to your place in the kitchen.</p>
            <p><Button to="/admissions/apply">Apply online</Button></p>
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

      {/* Fees */}
      <section className="section">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">Fees and payment</span>
            <h2>Total fees including VAT and registration</h2>
            <p>VAT is calculated on tuition only, with the registration fee added separately.</p>
          </Reveal>
          <Reveal className="table-wrap adm-fees">
            <table>
              <thead>
                <tr><th>Programme</th><th>Duration</th><th>Tuition</th><th>VAT (7.5%)</th><th>Registration</th><th>Total</th></tr>
              </thead>
              <tbody>
                {programmes.map((p) => {
                  const f = feeBreakdown(p.fee)
                  return (
                    <tr key={p.slug}>
                      <td><Link to={`/programmes/${p.slug}`}>{p.name}</Link></td>
                      <td>{p.durationWeeks} {p.durationWeeks === 1 ? 'week' : 'weeks'}</td>
                      {f
                        ? <><td>{formatFee(f.tuition)}</td><td>{formatFee(f.vat)}</td><td>{formatFee(f.registration)}</td><td><strong>{formatFee(f.total)}</strong></td></>
                        : <td colSpan={4} className="muted">Contact us for the fee</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Reveal>
          <ul className="adm-fees__notes">
            {feeNotes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      </section>

      {/* Sponsorships */}
      <section className="section">
        <div className="container adm-two">
          <Reveal className="adm-card adm-card--brand">
            <h2>Corporate sponsorships</h2>
            <p>
              We welcome students sponsored by hotels, restaurants and corporate organisations. Invoices can
              be billed directly to the sponsoring organisation.
            </p>
            <Button to="/contact" variant="light">Talk to us</Button>
          </Reveal>
          <Reveal className="adm-card" delay={0.1}>
            <h2>Merit-based assistance</h2>
            <p>
              Partial scholarships may be announced from time to time on our social media pages for
              exceptional individuals who show high potential but face financial constraints.
            </p>
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
                We run rolling admission, with major intakes in January, April, July and October. Each
                intake begins with an orientation covering facility induction, food safety and equipment
                familiarisation.
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
