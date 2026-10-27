'use client'
import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { programmeTypes } from '@cca/shared/programmes'
import { useProgrammes } from '../lib/useProgrammes.js'
import PageHeader from '../components/ui/PageHeader.jsx'
import ProgrammeCard from '../components/ProgrammeCard.jsx'
import Button from '../components/ui/Button.jsx'
import Reveal from '../components/ui/Reveal.jsx'
import './Programmes.css'

const EASE = [0.22, 1, 0.36, 1]


const includes = [
  { title: 'Hands-on kitchens', body: 'Practical sessions in fully equipped, stainless-steel kitchens.', icon: <path d="M7 21h10M6 13h12l-1 8H7zM8 13a4 4 0 118 0M12 5v4" /> },
  { title: 'Chef-led instruction', body: 'Learn directly from working chef-instructors.', icon: <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4" /> },
  { title: 'Uniform and materials', body: 'Your uniform, student handbook and learning materials are included.', icon: <path d="M4 5h16M4 12h16M4 19h10" /> },
  { title: 'Certificate on completion', body: 'Every course ends with a certificate employers can verify.', icon: <path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 21l-4.9 2.6.9-5.5-4-3.9 5.5-.8z" /> },
]

export default function Programmes() {
  const reduce = useReducedMotion()
  const { programmes } = useProgrammes()
  const [type, setType] = useState('all')
  const filters = [{ value: 'all', label: 'All programmes' },
    ...Object.entries(programmeTypes).filter(([value]) => programmes.some((p) => p.type === value)).map(([value, label]) => ({ value, label }))]
  const visible = type === 'all' ? programmes : programmes.filter((p) => p.type === type)

  const gridContainer = reduce
    ? {}
    : { hidden: {}, show: { transition: { staggerChildren: 0.08 } } }
  const gridItem = reduce
    ? {}
    : { hidden: { opacity: 0, y: 24, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE } } }

  return (
    <>
      <PageHeader
        eyebrow="Programmes"
        title="Programmes & courses"
        intro="From a one-week crash course to a full diploma. Fees shown are totals, including 7.5% VAT and the ₦15,000 registration fee."
      />

      <section className="section">
        <div className="container">
          {/* Programme explorer (spec §4.1) — duration and price filters to follow once fees are supplied */}
          <div className="prog-filter" role="tablist" aria-label="Filter programmes by type">
            {filters.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={type === f.value}
                className={`prog-filter__btn${type === f.value ? ' is-active' : ''}`}
                onClick={() => setType(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <motion.div
            key={type}
            className="grid prog-grid"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            animate={reduce ? false : 'show'}
          >
            {visible.map((p) => (
              <motion.div key={p.slug} variants={gridItem}>
                <ProgrammeCard programme={p} />
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* What every programme includes */}
      <section className="section section--warm">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">Included with every pathway</span>
            <h2>What you get</h2>
            <p>Whichever programme you choose, the essentials are covered.</p>
          </Reveal>
          <motion.div
            className="prog-includes"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-60px' }}
          >
            {includes.map((it) => (
              <motion.div key={it.title} className="prog-include" variants={gridItem}>
                <span className="prog-include__icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{it.icon}</svg>
                </span>
                <h3>{it.title}</h3>
                <p className="muted">{it.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Help band */}
      <section className="section">
        <Reveal className="container prog-help">
          <div>
            <h2>Not sure which programme fits?</h2>
            <p>Tell us your goals and experience, and we'll point you to the right pathway.</p>
          </div>
          <div className="prog-help__actions">
            <Button to="/contact">Talk to us</Button>
            <Button to="/admissions" variant="outline">How to apply</Button>
          </div>
        </Reveal>
      </section>
    </>
  )
}
