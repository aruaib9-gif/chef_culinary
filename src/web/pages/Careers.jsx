'use client'
import { motion, useReducedMotion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import Reveal from '../components/ui/Reveal.jsx'
import './Careers.css'

const introPhoto = '/images/chef3.jpg'
const alumniA = '/images/IMG_1663.JPG'
const alumniB = '/images/IMG_1671.JPG'
const alumniC = '/images/IMG_1664.JPG'

const EASE = [0.22, 1, 0.36, 1]

const paths = [
  { title: 'Restaurants & hotels', body: 'Line cook, chef de partie and kitchen roles in professional kitchens.', icon: <path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6" /> },
  { title: 'Catering & events', body: 'Cook for functions, weddings and large-scale events.', icon: <path d="M3 11h18M12 11V7a4 4 0 00-8 0M12 11v10M6 21h12" /> },
  { title: 'Bakery & pastry', body: 'Specialise in baking, pastry and dessert production.', icon: <path d="M4 10h16v10H4zM7 10V7a5 5 0 0110 0v3" /> },
  { title: 'Your own business', body: 'Start a food business, kitchen or brand of your own.', icon: <path d="M3 9l1-5h16l1 5M4 9v11h16V9M9 20v-6h6v6" /> },
  { title: 'Private & personal chef', body: 'Cook for homes, families and private clients.', icon: <path d="M12 3a4 4 0 014 4c0 2-2 3-2 5h-4c0-2-2-3-2-5a4 4 0 014-4zM8 16h8M9 20h6" /> },
  { title: 'Food entrepreneurship', body: 'Grow a food brand with costing and business know-how.', icon: <path d="M3 17l6-6 4 4 7-7M14 8h7v7" /> },
]

const skills = [
  'Food production — hands-on cooking across cuisines',
  'Cookery and food safety',
  'Food costing and portioning',
  'Inventory management',
  'Entrepreneurship',
  'Restaurant management and operations',
]

const alumni = [
  { src: alumniA, alt: 'Graduates at a cooking demonstration' },
  { src: alumniB, alt: 'A cohort of graduate chefs' },
  { src: alumniC, alt: 'A full cohort of graduates' },
]

export default function Careers() {
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
        eyebrow="Careers & alumni"
        title="Graduate outcomes"
        intro="We train chefs who are ready to work — and ready to build. Here's where our programmes can take you."
      />

      {/* Intro split */}
      <section className="section">
        <div className="container car-split">
          <Reveal className="car-split__media" y={40}>
            <img src={introPhoto} alt="Graduates celebrating with their certificates" loading="lazy" />
            <span className="car-split__tag">Career-ready, by design</span>
          </Reveal>
          <div className="car-split__body">
            <Reveal as="span" className="eyebrow">Ready for the industry</Reveal>
            <Reveal as="h2" delay={0.05}>From the classroom to the kitchen</Reveal>
            <Reveal as="p" delay={0.1}>
              Our programmes go beyond cooking. Alongside hands-on technique, you'll learn food
              costing, inventory, entrepreneurship and restaurant operations — the skills that make
              you employable and business-ready.
            </Reveal>
            <Reveal as="p" delay={0.15}>
              Every graduate earns a Certificate of Completion they can show employers, and which
              employers can confirm through our certificate verification.
            </Reveal>
            <Reveal delay={0.2}>
              <Button to="/verify" variant="outline">Verify a certificate</Button>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Career paths */}
      <section className="section section--warm">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">Where you can go</span>
            <h2>Career paths</h2>
            <p>A culinary qualification opens doors across the food industry.</p>
          </Reveal>
          <motion.div
            className="car-grid"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-60px' }}
          >
            {paths.map((p) => (
              <motion.div key={p.title} className="car-card" variants={gridItem}>
                <span className="car-card__icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p.icon}</svg>
                </span>
                <h3>{p.title}</h3>
                <p className="muted">{p.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Employability skills */}
      <section className="section">
        <div className="container car-skills">
          <Reveal className="car-skills__intro">
            <span className="eyebrow">Why employers value our graduates</span>
            <h2>Skills that get you hired</h2>
            <p>Our curriculum is built around what real kitchens and food businesses need.</p>
          </Reveal>
          <motion.ul
            className="car-skills__list"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-60px' }}
          >
            {skills.map((s) => (
              <motion.li key={s} variants={gridItem}>
                <span className="car-skills__check" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                </span>
                {s}
              </motion.li>
            ))}
          </motion.ul>
        </div>
      </section>

      {/* Employers */}
      <section className="section section--warm">
        <div className="container">
          <Reveal className="car-employers">
            <div className="car-employers__text">
              <span className="eyebrow">For employers &amp; partners</span>
              <h2>Hire a graduate, or sponsor a cohort</h2>
              <p>
                Looking for skilled, kitchen-ready chefs? Or want to train a team through a sponsored
                cohort — like our programmes with schemes such as SUPA ITF? We'd love to work with you.
              </p>
            </div>
            <div className="car-employers__actions">
              <Button to="/contact">Partner with us</Button>
              <Button to="/contact" variant="outline">Hire a graduate</Button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Alumni */}
      <section className="section">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">Our alumni</span>
            <h2>A growing community of chefs</h2>
            <p>Our graduates are cooking, teaching and building food businesses across Port Harcourt and beyond.</p>
          </Reveal>
          <motion.div
            className="car-alumni"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-40px' }}
          >
            {alumni.map((img) => (
              <motion.figure key={img.src} className="car-alumni__item" variants={gridItem}>
                <img src={img.src} alt={img.alt} loading="lazy" />
              </motion.figure>
            ))}
          </motion.div>
          <Reveal className="car-alumni__cta" delay={0.1}>
            <p>Are you a graduate of The Chefs Culinary Academy? We'd love to feature your story.</p>
            <Button to="/contact" variant="outline">Share your story</Button>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="section">
        <Reveal className="container car-cta">
          <h2>Start your culinary career</h2>
          <p>Join a programme built to make you employable and business-ready.</p>
          <div className="car-cta__actions">
            <Button to="/admissions/apply">Apply now</Button>
            <Button to="/programmes" variant="light">View programmes</Button>
          </div>
        </Reveal>
      </section>
    </>
  )
}
