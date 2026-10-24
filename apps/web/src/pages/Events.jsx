import { motion, useReducedMotion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import Reveal from '../components/ui/Reveal.jsx'
import './Events.css'

import introPhoto from '../assets/chef2.jpg'
import gradPhoto from '../assets/chef3.jpg'

const EASE = [0.22, 1, 0.36, 1]

const eventTypes = [
  { title: 'Short courses', body: 'Focused, bookable courses in baking, pastry and more — perfect for a quick, intensive skill-up.', icon: <path d="M4 5h16v14H4zM4 9h16M8 5v4" /> },
  { title: 'Masterclasses', body: 'Deep-dive sessions with chef-instructors on a single cuisine, dish or technique.', icon: <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4" /> },
  { title: 'Workshops', body: 'Hands-on, practical group sessions — roll up your sleeves and cook.', icon: <path d="M7 21h10M6 13h12l-1 8H7zM8 13a4 4 0 118 0M12 5v4" /> },
  { title: 'Cooking demonstrations', body: 'Live demos where our chefs show techniques step by step.', icon: <path d="M3 3v18h18M7 14l3-3 3 3 5-6" /> },
  { title: 'Graduations', body: 'Celebrate each cohort as students receive their Certificate of Completion.', icon: <path d="M22 10L12 5 2 10l10 5 10-5zM6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5" /> },
  { title: 'Private & group bookings', body: 'Book a bespoke session for your team, friends or celebration.', icon: <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /> },
]

export default function Events() {
  const reduce = useReducedMotion()

  const gridContainer = reduce
    ? {}
    : { hidden: {}, show: { transition: { staggerChildren: 0.09 } } }
  const gridItem = reduce
    ? {}
    : { hidden: { opacity: 0, y: 26, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE } } }

  return (
    <>
      <PageHeader
        eyebrow="Events"
        title="Events & short courses"
        intro="Workshops, masterclasses, demonstrations and graduations — there's always something cooking at the academy."
      />

      {/* Intro split */}
      <section className="section">
        <div className="container ev-split">
          <Reveal className="ev-split__media" y={40}>
            <img src={introPhoto} alt="Dishes prepared at an academy event" loading="lazy" />
            <span className="ev-split__tag">Always something cooking</span>
          </Reveal>
          <div className="ev-split__body">
            <Reveal as="span" className="eyebrow">What to expect</Reveal>
            <Reveal as="h2" delay={0.05}>Learn, taste and celebrate</Reveal>
            <Reveal as="p" delay={0.1}>
              From quick weekend workshops to full masterclasses and cohort graduations, our events
              are a chance to build new skills, meet fellow food lovers and see the academy in action.
            </Reveal>
            <Reveal as="p" delay={0.15}>
              Short courses are bookable, and many events are open to the public — whatever your level.
            </Reveal>
          </div>
        </div>
      </section>

      {/* Event types */}
      <section className="section section--warm">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">What's on</span>
            <h2>Types of events</h2>
            <p>The kinds of sessions we run throughout the year.</p>
          </Reveal>
          <motion.div
            className="ev-grid"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-60px' }}
          >
            {eventTypes.map((e) => (
              <motion.div key={e.title} className="ev-card" variants={gridItem}>
                <span className="ev-card__icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{e.icon}</svg>
                </span>
                <h3>{e.title}</h3>
                <p className="muted">{e.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Short courses highlight */}
      <section className="section">
        <div className="container ev-highlight">
          <Reveal className="ev-highlight__media" y={40}>
            <img src={gradPhoto} alt="Graduates celebrating at the academy" loading="lazy" />
          </Reveal>
          <div className="ev-highlight__body">
            <Reveal as="span" className="eyebrow">Book a short course</Reveal>
            <Reveal as="h2" delay={0.05}>Skill up in a few weeks</Reveal>
            <Reveal as="p" delay={0.1}>
              Our short courses and workshops focus on baking, pastry and other in-demand skills —
              ideal if you want a focused, hands-on experience without committing to the full
              programme.
            </Reveal>
            <Reveal className="ev-highlight__actions" delay={0.15}>
              <Button to="/programmes/short-courses">View short courses</Button>
              <Button to="/contact" variant="outline">Enquire about dates</Button>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Stay updated */}
      <section className="section section--warm">
        <div className="container">
          <Reveal className="ev-updates">
            <div className="ev-updates__icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
            </div>
            <div className="ev-updates__text">
              <h2>Don't miss the next one</h2>
              <p>
                New workshops, masterclasses and graduation dates are announced throughout the year.
                Get in touch to hear what's coming up, or follow us on social media for the latest.
              </p>
            </div>
            <div className="ev-updates__actions">
              <Button to="/contact">Ask what's coming up</Button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="section">
        <Reveal className="container ev-cta">
          <h2>Want to attend or host an event?</h2>
          <p>Whether you're joining a workshop or planning a private session, we'd love to hear from you.</p>
          <div className="ev-cta__actions">
            <Button to="/contact">Contact us</Button>
            <Button to="/programmes" variant="light">Browse programmes</Button>
          </div>
        </Reveal>
      </section>
    </>
  )
}
