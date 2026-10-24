import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { useProgrammes } from '../lib/useProgrammes.js'
import Button from '../components/ui/Button.jsx'
import ProgrammeCard from '../components/ProgrammeCard.jsx'
import Reveal from '../components/ui/Reveal.jsx'
import './Home.css'

// Kitchen & cohort photography (spec §13)
import heroPhoto from '../assets/IMG_1663.JPG'
import chefPortrait from '../assets/IMG_1665.JPG'
import chefAccent from '../assets/IMG_1670.JPG'
import cohortPhoto from '../assets/IMG_1664.JPG'
import galleryA from '../assets/IMG_1672.JPG'
import galleryB from '../assets/IMG_1666.JPG'
import galleryC from '../assets/IMG_1668.JPG'
import galleryD from '../assets/IMG_1669.JPG'
import galleryE from '../assets/IMG_1667.JPG'
import galleryF from '../assets/IMG_1671.JPG'
import practicalPhoto from '../assets/Chef1.jpg'
import foodPhoto from '../assets/chef2.jpg'
import graduationPhoto from '../assets/chef3.jpg'

const EASE = [0.22, 1, 0.36, 1]

// Placeholder figures — academy to supply real numbers.
const stats = [
  { value: '—', label: 'Students trained' },
  { value: '—', label: 'Years of excellence' },
  { value: '—', label: 'Graduates placed' },
  { value: '3', label: 'Programme pathways' },
]

const reasons = [
  { title: 'Hands-on kitchens', body: 'Practical classes in professional kitchens, three days a week.' },
  { title: 'Experienced chef-instructors', body: 'Learn Nigerian, African, Asian and European cuisines from working chefs.' },
  { title: 'Career-ready', body: 'Food costing, inventory, entrepreneurship and restaurant operations included.' },
]

const gallery = [
  { src: galleryA, alt: 'Chefs presenting dishes at a cooking demonstration' },
  { src: foodPhoto, alt: 'A spread of dishes prepared at the academy' },
  { src: galleryC, alt: 'Graduate chef in front of the academy mural' },
  { src: galleryD, alt: 'Chef at the academy service counter' },
  { src: graduationPhoto, alt: 'Graduates celebrating with their certificates' },
  { src: galleryE, alt: 'Instructors and students at the academy' },
  { src: galleryF, alt: 'A cohort of chefs at a class session' },
  { src: galleryB, alt: 'Trainee chefs in the teaching kitchen' },
]

// Value-prop items shown in the frosted hero bar
const heroHighlights = [
  {
    title: 'Hands-on kitchens',
    sub: '3 days a week',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 21h10" /><path d="M6 13h12l-1 8H7z" /><path d="M8 13a4 4 0 118 0" /><path d="M12 5v4" /></svg>,
  },
  {
    title: 'Chef-led training',
    sub: 'Working chef instructors',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
  },
  {
    title: '3 programme pathways',
    sub: 'Full-time & short courses',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7z" /></svg>,
  },
]

// Hero background slideshow
const heroSlides = [
  { src: heroPhoto, alt: 'Chefs at a cooking demonstration' },
  { src: cohortPhoto, alt: 'A full cohort of chefs at the academy' },
  { src: galleryA, alt: 'Chefs presenting dishes at the academy' },
]

// How enrolment works
const journey = [
  { step: '01', title: 'Apply online', body: 'Submit your application in minutes and tell us the pathway you want.' },
  { step: '02', title: 'Train hands-on', body: 'Practical and theory classes Mon, Wed & Fri in professional kitchens.' },
  { step: '03', title: 'Get certified', body: 'Complete assessments and project work to earn your certificate.' },
  { step: '04', title: 'Launch your career', body: 'Food costing, business and entrepreneurship skills to start out strong.' },
]

// Curriculum highlights (from the professional programme course list)
const curriculum = [
  { title: 'Cookery & food safety', body: 'Kitchen fundamentals, hygiene and safe food handling.' },
  { title: 'Food production', body: 'Nigerian, African, Asian and European techniques, hands-on.' },
  { title: 'Inventory management', body: 'Stock control, purchasing and reducing waste.' },
  { title: 'Food costing', body: 'Price dishes for profit and manage margins.' },
  { title: 'Entrepreneurship', body: 'Build and run your own food business.' },
  { title: 'Restaurant management', body: 'Operations, service and leading a kitchen team.' },
]

const cuisines = ['Nigerian', 'African', 'Asian', 'European']

const faqs = [
  { q: 'How long are the programmes?', a: 'Between 8 and 16 weeks depending on your pathway — short courses run 8 weeks, sponsored cohorts 12 weeks and the full professional programme 16 weeks.' },
  { q: 'When are classes held?', a: 'Classes hold three days a week — Monday, Wednesday and Friday — combining theory and practical kitchen sessions.' },
  { q: 'Do I need prior experience?', a: 'No. Our programmes start from the fundamentals, so complete beginners are welcome alongside those looking to sharpen their skills.' },
  { q: 'How much does it cost?', a: 'Fees are shared on request. Send us an enquiry or start your application and our team will get back to you with the details.' },
  { q: "What's included?", a: 'The professional programme covers your handbook and workbook, uniform, class assignments and project work.' },
  { q: 'Where is the academy located?', a: 'Chimatem Complex, Psychiatric Road, Rumigbo/Rumuola, Port Harcourt.' },
]

export default function Home() {
  const { programmes } = useProgrammes()
  const reduce = useReducedMotion()
  const [slide, setSlide] = useState(0)

  // Auto-advance the hero slideshow (paused under reduced-motion)
  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => setSlide((s) => (s + 1) % heroSlides.length), 5500)
    return () => clearInterval(id)
  }, [reduce])

  // Stagger variants (disabled under reduced-motion)
  const container = reduce
    ? {}
    : { hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } } }
  const item = reduce
    ? {}
    : { hidden: { opacity: 0, y: 26 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } } }
  const gridContainer = reduce
    ? {}
    : { hidden: {}, show: { transition: { staggerChildren: 0.1 } } }
  const gridItem = reduce
    ? {}
    : { hidden: { opacity: 0, y: 30, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: EASE } } }

  return (
    <>
      <section className="hero">
        {heroSlides.map((s, i) => (
          <img
            key={s.src}
            className={`hero__bg${reduce ? '' : ' hero__bg--kenburns'}${i === slide ? ' is-active' : ''}`}
            src={s.src}
            alt=""
            aria-hidden="true"
          />
        ))}
        <div className="hero__scrim" aria-hidden="true" />

        <div className="container hero__inner">
          <motion.div
            className="hero__content"
            variants={container}
            initial={reduce ? false : 'hidden'}
            animate={reduce ? false : 'show'}
          >
            <motion.span className="hero__eyebrow" variants={item}>
              Port Harcourt · Culinary School
            </motion.span>
            <motion.h1 variants={item}>
              Train as a <span className="accent">professional chef</span>
            </motion.h1>
            <motion.p variants={item}>
              Professional cookery programmes, short courses and sponsored cohorts — theory and
              practical, taught to an international standard.
            </motion.p>
            <motion.div className="hero__actions" variants={item}>
              <Button to="/admissions/apply">Apply now</Button>
              <Button to="/contact" variant="light">Enquire</Button>
            </motion.div>

            <motion.div className="hero__proof" variants={item}>
              <div className="hero__avatars">
                <img src={chefPortrait} alt="" aria-hidden="true" />
                <img src={galleryC} alt="" aria-hidden="true" />
                <img src={galleryD} alt="" aria-hidden="true" />
                <img src={chefAccent} alt="" aria-hidden="true" />
              </div>
              <span>Join a growing community of chefs in training.</span>
            </motion.div>
          </motion.div>

          <div className="hero__dots" role="tablist" aria-label="Hero slides">
            {heroSlides.map((s, i) => (
              <button
                key={s.src}
                type="button"
                className={`hero__dot${i === slide ? ' is-active' : ''}`}
                aria-label={`Show slide ${i + 1}`}
                aria-selected={i === slide}
                onClick={() => setSlide(i)}
              />
            ))}
          </div>
        </div>

        <motion.div
          className="hero__bar"
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={reduce ? false : { opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5, ease: EASE }}
        >
          <div className="container hero__bar-inner">
            {heroHighlights.map((h) => (
              <div key={h.title} className="hero__stat">
                <span className="hero__stat-icon" aria-hidden="true">{h.icon}</span>
                <div className="hero__stat-text">
                  <strong>{h.title}</strong>
                  <span>{h.sub}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      <section className="section">
        <motion.div
          className="container stats"
          variants={gridContainer}
          initial={reduce ? false : 'hidden'}
          whileInView={reduce ? undefined : 'show'}
          viewport={{ once: true, margin: '-60px' }}
        >
          {stats.map((s) => (
            <motion.div key={s.label} variants={gridItem}>
              <strong>{s.value}</strong>
              <span className="muted">{s.label}</span>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <section className="section section--warm">
        <div className="container">
          <Reveal className="section__header">
            <span className="eyebrow">Programmes</span>
            <h2>Find your pathway</h2>
            <p>From a full professional cookery programme to focused baking and pastry workshops.</p>
          </Reveal>
          <motion.div
            className="grid"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-60px' }}
          >
            {programmes.map((p) => (
              <motion.div key={p.slug} variants={gridItem}>
                <ProgrammeCard programme={p} />
              </motion.div>
            ))}
          </motion.div>
          <Reveal as="p" delay={0.1} style={{ marginTop: 'var(--space-5)' }}>
            <Link to="/programmes">View all programmes →</Link>
          </Reveal>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">How it works</span>
            <h2>Your journey to the kitchen</h2>
            <p>From application to your first role — four simple steps.</p>
          </Reveal>
          <motion.ol
            className="journey"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-60px' }}
          >
            {journey.map((j) => (
              <motion.li key={j.step} className="journey__step" variants={gridItem}>
                <span className="journey__num">{j.step}</span>
                <h3>{j.title}</h3>
                <p className="muted">{j.body}</p>
              </motion.li>
            ))}
          </motion.ol>
        </div>
      </section>

      <section className="section">
        <div className="container split">
          <Reveal className="split__media" y={40}>
            <img className="split__photo" src={chefPortrait} alt="Chef instructor in the academy kitchen" loading="lazy" />
            <img className="split__photo split__photo--accent" src={practicalPhoto} alt="Students cooking in a practical class" loading="lazy" />
            <span className="split__badge">Real kitchens</span>
          </Reveal>
          <div className="split__body">
            <Reveal as="span" className="eyebrow">Why choose us</Reveal>
            <Reveal as="h2" delay={0.05}>Learn in a real kitchen</Reveal>
            <ul className="reasons">
              {reasons.map((r, i) => (
                <Reveal as="li" key={r.title} className="reasons__item" delay={0.12 + i * 0.1}>
                  <h3>{r.title}</h3>
                  <p className="muted">{r.body}</p>
                </Reveal>
              ))}
            </ul>
            <Reveal delay={0.3}>
              <Button to="/about">About the academy</Button>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="section section--warm">
        <div className="container">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">Curriculum</span>
            <h2>What you'll learn</h2>
            <p>A practical curriculum that turns beginners into career-ready chefs.</p>
          </Reveal>
          <motion.div
            className="curriculum"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-60px' }}
          >
            {curriculum.map((c) => (
              <motion.div key={c.title} className="curriculum__card" variants={gridItem}>
                <span className="curriculum__check" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                </span>
                <div>
                  <h3>{c.title}</h3>
                  <p className="muted">{c.body}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="cuisines">
        <img className="cuisines__bg" src={foodPhoto} alt="" aria-hidden="true" />
        <div className="cuisines__overlay" aria-hidden="true" />
        <Reveal className="container cuisines__content">
          <span className="eyebrow">Cuisines</span>
          <h2>Cuisines you'll master</h2>
          <p>Train across four culinary traditions — from local favourites to international menus.</p>
          <ul className="cuisines__list">
            {cuisines.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Reveal>
      </section>

      <section className="section section--warm">
        <div className="container">
          <Reveal className="section__header">
            <span className="eyebrow">Life at the academy</span>
            <h2>Inside our kitchens</h2>
            <p>Hands-on training, a vibrant community and graduates ready for the industry.</p>
          </Reveal>
          <motion.div
            className="gallery"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            whileInView={reduce ? undefined : 'show'}
            viewport={{ once: true, margin: '-40px' }}
          >
            {gallery.map((img, i) => (
              <motion.figure key={img.src} className={`gallery__item gallery__item--${i + 1}`} variants={gridItem}>
                <img src={img.src} alt={img.alt} loading="lazy" />
              </motion.figure>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="section">
        <div className="container faq">
          <Reveal className="section__header section__header--center">
            <span className="eyebrow">FAQ</span>
            <h2>Questions, answered</h2>
            <p>Everything you need to know before you apply.</p>
          </Reveal>
          <div className="faq__list">
            {faqs.map((f, i) => (
              <Reveal as="details" key={f.q} className="faq__item" delay={i * 0.05} {...(i === 0 ? { open: true } : {})}>
                <summary>
                  {f.q}
                  <span className="faq__icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                  </span>
                </summary>
                <p>{f.a}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="cta">
        <img className="cta__bg" src={cohortPhoto} alt="" aria-hidden="true" />
        <div className="cta__overlay" aria-hidden="true" />
        <Reveal className="container cta__content" y={32}>
          <h2>Join the next cohort</h2>
          <p>Applications are open for our professional cookery programmes and short courses.</p>
          <div className="cta__actions">
            <Button to="/admissions/apply">Apply now</Button>
            <Button to="/contact" variant="light">Ask a question</Button>
          </div>
        </Reveal>
      </section>

      {/* TODO: testimonials, upcoming intakes, latest news, Instagram feed, enquiry form (spec §3 Home) */}
    </>
  )
}
