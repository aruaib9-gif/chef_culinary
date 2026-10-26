'use client'
import { motion, useReducedMotion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import Reveal from '../components/ui/Reveal.jsx'
import './About.css'

const storyPhoto = '/images/IMG_1665.JPG'
const facilitiesPhoto = '/images/Chef1.jpg'
const teamA = '/images/IMG_1668.JPG'
const teamB = '/images/IMG_1670.JPG'
const teamC = '/images/IMG_1669.JPG'
const teamD = '/images/IMG_1667.JPG'

const EASE = [0.22, 1, 0.36, 1]

const values = [
  { title: 'Excellence', body: 'We hold ourselves and our students to high standards in every dish and every lesson.' },
  { title: 'Passion', body: 'We believe great cooking starts with a genuine love for food.' },
  { title: 'Hygiene and safety', body: 'Clean, safe kitchens are the foundation of professional practice.' },
  { title: 'Creativity', body: 'We encourage students to explore flavours, techniques and presentation.' },
  { title: 'Integrity', body: 'We are honest, fair and professional in all our dealings.' },
  { title: 'Practical learning', body: 'Skills are built by doing, so our training is hands-on.' },
  { title: 'Growth', body: "We support every student's journey from beginner to professional." },
]

const coreSkills = ['Food safety', 'Food production', 'Food costing', 'Food plating and styling']

const facilities = [
  'Dedicated theory classrooms for culinary principles, food safety and hospitality management',
  'Fully equipped, stainless-steel practical kitchens',
  'Professional chef uniforms for every practical session',
  'Hands-on practice from your first week',
  'Mentorship from working chef-instructors',
  'A certificate on completion of every course',
]

const team = [
  { src: teamA, alt: 'Chef-instructor at the academy' },
  { src: teamB, alt: 'Chef-instructor at the academy' },
  { src: teamC, alt: 'Chef-instructor at the academy' },
  { src: teamD, alt: 'Instructors and students at the academy' },
]

export default function About() {
  const reduce = useReducedMotion()

  const gridContainer = reduce
    ? {}
    : { hidden: {}, show: { transition: { staggerChildren: 0.1 } } }
  const gridItem = reduce
    ? {}
    : { hidden: { opacity: 0, y: 28, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: EASE } } }

  return (
    <>
      <PageHeader
        eyebrow="About us"
        title="Where professional chefs are raised"
        intro="A premier culinary institution in the heart of Port Harcourt, built on the principle of “Quality Chefs, Healthy Life”."
      />

      {/* Story */}
      <section className="section">
        <div className="container about-split">
          <Reveal className="about-split__media" y={40}>
            <img src={storyPhoto} alt="A chef-instructor in the academy kitchen" loading="lazy" />
            <span className="about-split__tag">Quality Chefs, Healthy Life</span>
          </Reveal>
          <div className="about-split__body">
            <Reveal as="span" className="eyebrow">Who we are</Reveal>
            <Reveal as="h2" delay={0.05}>Professional mastery and personal transformation</Reveal>
            <Reveal as="p" delay={0.1}>
              The Chefs Culinary Academy believes the kitchen is a space for both professional mastery and
              personal transformation, guided by our philosophy that “cooking and baking is both physical
              and mental therapy”.
            </Reveal>
            <Reveal as="p" delay={0.15}>
              We train aspiring chefs, home cooks, bakers and food entrepreneurs through hands-on programmes
              in a real kitchen environment, so you graduate ready to cook, create and earn.
            </Reveal>
            <Reveal as="p" delay={0.2}>
              Whether you want a quick skills boost or a full professional qualification, we have a
              programme that fits your goals — from a one-week spice and herbs class to our 36-week Diploma
              in Culinary Arts.
            </Reveal>
          </div>
        </div>
      </section>

      {/* Vision & Mission */}
      <section className="section section--warm">
        <div className="container">
          <motion.div
            className="about-vm"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-60px' }}
          >
            <motion.div className="about-vm__card" variants={gridItem}>
              <span className="about-vm__label">Vision</span>
              <p>
                To be the leading culinary academy in Nigeria, known for raising professional chefs who
                set the standard for skill, creativity and excellence in the food industry.
              </p>
            </motion.div>
            <motion.div className="about-vm__card" variants={gridItem}>
              <span className="about-vm__label">Mission</span>
              <p>
                To train skilled, confident and responsible culinary professionals through practical,
                quality instruction, preparing every student to succeed in kitchens, businesses and
                communities across Nigeria and beyond.
              </p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Values */}
      <section className="section">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">What we stand for</span>
            <h2>Our core values</h2>
            <p>The principles behind every class, dish and graduate.</p>
          </Reveal>
          <motion.div
            className="about-values"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-60px' }}
          >
            {values.map((v) => (
              <motion.div key={v.title} className="about-value" variants={gridItem}>
                <h3>{v.title}</h3>
                <p className="muted">{v.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Facilities */}
      <section className="section section--warm">
        <div className="container about-split about-split--reverse">
          <Reveal className="about-split__media" y={40}>
            <img src={facilitiesPhoto} alt="Students cooking in a practical class" loading="lazy" />
          </Reveal>
          <div className="about-split__body">
            <Reveal as="span" className="eyebrow">Our approach to training</Reveal>
            <Reveal as="h2" delay={0.05}>From the classroom to the kitchen</Reveal>
            <Reveal as="p" delay={0.1}>
              We bridge the gap between passion and professional expertise. Training begins in theory
              classrooms, where you build a strong foundation, then moves into our practical kitchens, where
              you bring that knowledge to life through rigorous hands-on practice.
            </Reveal>
            <Reveal as="p" delay={0.11}>
              Whether you aspire to a global hospitality career or want to master local African delicacies,
              we provide the tools, mentorship and environment to make it happen.
            </Reveal>
            <ul className="about-list">
              {facilities.map((f, i) => (
                <Reveal as="li" key={f} delay={0.12 + i * 0.06}>
                  <span className="about-list__check" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  {f}
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Instructors */}
      <section className="section">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">Our people</span>
            <h2>Learn from working chefs</h2>
            <p>
              Our chef-instructors bring professional kitchen experience across African and Asian cuisine,
              pastry, cakes and mixology — and a genuine commitment to seeing you succeed.
            </p>
            <ul className="about-skills" aria-label="Core skills">
              {coreSkills.map((k) => <li key={k}>{k}</li>)}
            </ul>
          </Reveal>
          <motion.div
            className="about-team"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-40px' }}
          >
            {team.map((t) => (
              <motion.figure key={t.src} className="about-team__item" variants={gridItem}>
                <img src={t.src} alt={t.alt} loading="lazy" />
              </motion.figure>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Certification note */}
      <section className="section section--warm">
        <div className="container">
          <Reveal className="about-note">
            <h2>Affiliated, accredited and verifiable</h2>
            <p>
              The Chefs Culinary Academy is affiliated with SUPA ITF and is an accredited NABTEB centre.
              Every course ends with a certificate that employers can confirm through our online
              certificate verification.
            </p>
            <div className="about-note__actions">
              <Button to="/verify" variant="outline">Verify a certificate</Button>
              <Button to="/programmes">Explore programmes</Button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="section">
        <Reveal className="container about-cta">
          <h2>Start your culinary journey</h2>
          <p>Your future in the kitchen begins here. Apply today and take the first step toward becoming a professional chef.</p>
          <div className="about-cta__actions">
            <Button to="/admissions/apply">Apply now</Button>
            <Button to="/contact" variant="light">Contact us</Button>
          </div>
        </Reveal>
      </section>
    </>
  )
}
