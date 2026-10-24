import { motion, useReducedMotion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import Reveal from '../components/ui/Reveal.jsx'
import './About.css'

import storyPhoto from '../assets/IMG_1665.JPG'
import facilitiesPhoto from '../assets/Chef1.jpg'
import teamA from '../assets/IMG_1668.JPG'
import teamB from '../assets/IMG_1670.JPG'
import teamC from '../assets/IMG_1669.JPG'
import teamD from '../assets/IMG_1667.JPG'

const EASE = [0.22, 1, 0.36, 1]

const values = [
  { title: 'Quality', body: 'We hold every dish — and every lesson — to a professional standard.' },
  { title: 'Hands-on learning', body: 'Real kitchens, real ingredients, real practice, three days a week.' },
  { title: 'Healthy living', body: 'Good food is healthy food. We teach nutrition and safe food handling.' },
  { title: 'Entrepreneurship', body: 'We equip graduates to build and run their own food businesses.' },
  { title: 'Community', body: 'A supportive cohort and alumni network that lasts beyond graduation.' },
  { title: 'Integrity', body: 'Honest teaching, fair fees and certificates employers can verify.' },
]

const facilities = [
  'Professional teaching kitchens with hands-on workstations',
  'Live demonstration stations for chef-led sessions',
  'Practical classes three days a week — Mon, Wed & Fri',
  'Food safety and hygiene standards throughout',
  'A full curriculum covering theory and practical',
  'Certificate of Completion on graduation',
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
        title="Our story"
        intro="The Chefs Culinary Academy trains the next generation of professional chefs in Port Harcourt — hands-on, practical and taught to an international standard."
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
            <Reveal as="h2" delay={0.05}>A culinary school built around real kitchens</Reveal>
            <Reveal as="p" delay={0.1}>
              The Chefs Culinary Academy is a professional culinary school based in Port Harcourt,
              Nigeria. We turn a passion for food into a profession — training aspiring and practising
              cooks into confident, career-ready chefs.
            </Reveal>
            <Reveal as="p" delay={0.15}>
              Our programmes blend hands-on kitchen practice with solid culinary theory, spanning
              Nigerian and African classics through to Asian and European techniques. Students learn
              from working chef-instructors in professional kitchens, three days a week.
            </Reveal>
            <Reveal as="p" delay={0.2}>
              More than cooking, we teach the business of food — costing, inventory, entrepreneurship
              and restaurant operations — so our graduates are ready to work or build something of
              their own.
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
                To be a leading culinary academy in Nigeria, raising a generation of skilled,
                enterprising chefs who shape the future of food.
              </p>
            </motion.div>
            <motion.div className="about-vm__card" variants={gridItem}>
              <span className="about-vm__label">Mission</span>
              <p>
                To deliver practical, affordable and industry-relevant culinary training that turns a
                love of food into a profession and a sustainable business.
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
            <h2>Our values</h2>
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
            <Reveal as="span" className="eyebrow">Facilities</Reveal>
            <Reveal as="h2" delay={0.05}>Where you'll learn</Reveal>
            <Reveal as="p" delay={0.1}>
              Our training happens in professional kitchens equipped for real, hands-on work — not just
              lectures. Every student gets time at the stove.
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
              Our chef-instructors bring professional kitchen experience across Nigerian, African,
              Asian and European cuisines — and a genuine commitment to seeing you succeed.
            </p>
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
            <h2>Certified, and verifiable</h2>
            <p>
              Graduates earn a Certificate of Completion they can proudly show employers — and which
              employers can confirm through our certificate verification. We also run dedicated
              sponsored cohorts for organisations and schemes such as SUPA ITF.
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
          <h2>Come train with us</h2>
          <p>Find us in Port Harcourt, or reach out — we'd love to hear from you.</p>
          <div className="about-cta__actions">
            <Button to="/admissions/apply">Apply now</Button>
            <Button to="/contact" variant="light">Contact us</Button>
          </div>
        </Reveal>
      </section>
    </>
  )
}
