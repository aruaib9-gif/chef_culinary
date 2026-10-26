'use client'
import { motion, useReducedMotion } from 'framer-motion'
import { getProgramme } from '@cca/shared/programmes'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import Reveal from '../components/ui/Reveal.jsx'
import './StudentLife.css'

const introPhoto = '/images/Chef1.jpg'
const uniformPhoto = '/images/IMG_1666.JPG'
const gradPhoto = '/images/IMG_1671.JPG'
const galleryA = '/images/IMG_1663.JPG'
const galleryB = '/images/chef2.jpg'
const galleryC = '/images/IMG_1668.JPG'
const galleryD = '/images/chef3.jpg'

const EASE = [0.22, 1, 0.36, 1]

const facilities = [
  { title: 'Professional kitchens', body: 'Hands-on workstations where every student gets time at the stove.' },
  { title: 'Demonstration stations', body: 'Live, chef-led demos so you see techniques before you try them.' },
  { title: 'A world of cuisines', body: 'Space to practise Nigerian, African, Asian and European dishes.' },
  { title: 'Safety first', body: 'Food safety and hygiene standards built into every session.' },
]

// Kit is grounded in what the professional programme fee covers.
const kit = getProgramme('diploma-in-culinary-arts')?.feeCovers ?? []

const events = [
  { title: 'Live cooking demos', body: 'Watch chef-instructors at work, then recreate the dish yourself.' },
  { title: 'Plating & food projects', body: 'Put your skills together on real dishes and presentation projects.' },
  { title: 'Masterclasses & workshops', body: 'Focused short sessions on baking, pastry and special techniques.' },
  { title: 'Graduation', body: 'Celebrate your Certificate of Completion with your cohort.' },
]

const gallery = [
  { src: galleryA, alt: 'Students at a cooking demonstration' },
  { src: galleryB, alt: 'Dishes plated by students' },
  { src: galleryC, alt: 'A graduate chef at the academy' },
  { src: galleryD, alt: 'Graduates celebrating with certificates' },
]

export default function StudentLife() {
  const reduce = useReducedMotion()

  const gridContainer = reduce
    ? {}
    : { hidden: {}, show: { transition: { staggerChildren: 0.1 } } }
  const gridItem = reduce
    ? {}
    : { hidden: { opacity: 0, y: 28, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE } } }

  return (
    <>
      <PageHeader
        eyebrow="Student life"
        title="Life at the academy"
        intro="Hands-on kitchens, a supportive cohort and plenty to get stuck into — here's what to expect as a student."
      />

      {/* Intro split */}
      <section className="section">
        <div className="container sl-split">
          <Reveal className="sl-split__media" y={40}>
            <img src={introPhoto} alt="Students cooking in a practical class" loading="lazy" />
            <span className="sl-split__tag">Hands-on from day one</span>
          </Reveal>
          <div className="sl-split__body">
            <Reveal as="span" className="eyebrow">A day in the kitchen</Reveal>
            <Reveal as="h2" delay={0.05}>Learning on your feet</Reveal>
            <Reveal as="p" delay={0.1}>
              At The Chefs Culinary Academy, learning happens where it matters — in the kitchen, with
              real ingredients. Classes pair theory with practical sessions three days a week, so
              you're cooking, plating and tasting from the very start.
            </Reveal>
            <Reveal as="p" delay={0.15}>
              You'll work alongside chef-instructors and a friendly cohort, building the confidence and
              habits of a professional kitchen one dish at a time.
            </Reveal>
          </div>
        </div>
      </section>

      {/* Facilities */}
      <section className="section section--warm">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">Kitchens &amp; facilities</span>
            <h2>Where you'll train</h2>
            <p>Real, working kitchens built for hands-on learning.</p>
          </Reveal>
          <motion.div
            className="sl-grid"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-60px' }}
          >
            {facilities.map((f) => (
              <motion.div key={f.title} className="sl-card" variants={gridItem}>
                <h3>{f.title}</h3>
                <p className="muted">{f.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Uniform & kit */}
      <section className="section">
        <div className="container sl-split sl-split--reverse">
          <Reveal className="sl-split__media" y={40}>
            <img src={uniformPhoto} alt="Trainee chefs in academy uniform" loading="lazy" />
          </Reveal>
          <div className="sl-split__body">
            <Reveal as="span" className="eyebrow">Uniform &amp; kit</Reveal>
            <Reveal as="h2" delay={0.05}>Kitted out for the kitchen</Reveal>
            <Reveal as="p" delay={0.1}>
              Students on the professional programme are set up for success from day one. Your
              programme fee covers:
            </Reveal>
            <ul className="sl-list">
              {kit.map((item, i) => (
                <Reveal as="li" key={item} delay={0.14 + i * 0.07}>
                  <span className="sl-list__check" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  {item}
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Events & projects */}
      <section className="section section--warm">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">Events &amp; projects</span>
            <h2>More than classes</h2>
            <p>There's always something happening between lessons.</p>
          </Reveal>
          <motion.div
            className="sl-grid"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-60px' }}
          >
            {events.map((e) => (
              <motion.div key={e.title} className="sl-card" variants={gridItem}>
                <h3>{e.title}</h3>
                <p className="muted">{e.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Gallery */}
      <section className="section">
        <div className="container">
          <Reveal className="section__header">
            <span className="eyebrow">In pictures</span>
            <h2>Moments from the academy</h2>
          </Reveal>
          <motion.div
            className="sl-gallery"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-40px' }}
          >
            {gallery.map((img) => (
              <motion.figure key={img.src} className="sl-gallery__item" variants={gridItem}>
                <img src={img.src} alt={img.alt} loading="lazy" />
              </motion.figure>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="section">
        <Reveal className="container sl-cta">
          <h2>See yourself in our kitchens?</h2>
          <p>Apply to join the next cohort, or browse our programmes to find your pathway.</p>
          <div className="sl-cta__actions">
            <Button to="/admissions/apply">Apply now</Button>
            <Button to="/programmes" variant="light">View programmes</Button>
          </div>
        </Reveal>
      </section>
    </>
  )
}
