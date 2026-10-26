'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader.jsx'
import './Gallery.css'

const img1663 = '/images/IMG_1663.JPG'
const img1664 = '/images/IMG_1664.JPG'
const img1665 = '/images/IMG_1665.JPG'
const img1666 = '/images/IMG_1666.JPG'
const img1667 = '/images/IMG_1667.JPG'
const img1668 = '/images/IMG_1668.JPG'
const img1669 = '/images/IMG_1669.JPG'
const img1670 = '/images/IMG_1670.JPG'
const img1671 = '/images/IMG_1671.JPG'
const img1672 = '/images/IMG_1672.JPG'
const chef1 = '/images/Chef1.jpg'
const chef2 = '/images/chef2.jpg'
const chef3 = '/images/chef3.jpg'

const EASE = [0.22, 1, 0.36, 1]

const categories = [
  { value: 'all', label: 'All' },
  { value: 'classes', label: 'Classes' },
  { value: 'dishes', label: 'Student dishes' },
  { value: 'graduation', label: 'Graduations' },
  { value: 'events', label: 'Events' },
]

const photos = [
  { src: img1663, cat: 'events', alt: 'Chefs at a cooking demonstration' },
  { src: chef1, cat: 'classes', alt: 'Students cooking in a practical class' },
  { src: chef2, cat: 'dishes', alt: 'A spread of dishes prepared at the academy' },
  { src: img1665, cat: 'classes', alt: 'Chef instructor in the academy kitchen' },
  { src: chef3, cat: 'graduation', alt: 'Graduates celebrating with their certificates' },
  { src: img1666, cat: 'classes', alt: 'Two trainee chefs in the teaching kitchen' },
  { src: img1672, cat: 'events', alt: 'A cohort of chefs at a cooking demonstration' },
  { src: img1668, cat: 'classes', alt: 'A graduate chef in front of the academy mural' },
  { src: img1671, cat: 'classes', alt: 'A cohort of chefs at a class session' },
  { src: img1664, cat: 'events', alt: 'A full cohort of chefs at the academy' },
  { src: img1667, cat: 'classes', alt: 'Instructors and students at the academy' },
  { src: img1669, cat: 'classes', alt: 'A chef at the academy service counter' },
  { src: img1670, cat: 'classes', alt: 'A chef at a cooking station' },
]

export default function Gallery() {
  const reduce = useReducedMotion()
  const [cat, setCat] = useState('all')
  const [active, setActive] = useState(null) // index into the visible list

  const visible = cat === 'all' ? photos : photos.filter((p) => p.cat === cat)

  const close = useCallback(() => setActive(null), [])
  const show = useCallback((dir) => {
    setActive((i) => {
      if (i === null) return i
      return (i + dir + visible.length) % visible.length
    })
  }, [visible.length])

  useEffect(() => {
    if (active === null) return
    const onKey = (e) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') show(1)
      else if (e.key === 'ArrowLeft') show(-1)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [active, close, show])

  const gridContainer = reduce
    ? {}
    : { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }
  const gridItem = reduce
    ? {}
    : { hidden: { opacity: 0, y: 20, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE } } }

  return (
    <>
      <PageHeader
        eyebrow="Gallery"
        title="Photos & videos"
        intro="Practical classes, graduations, events and the dishes our students create. A look inside The Chefs Culinary Academy."
      />

      <section className="section">
        <div className="container">
          <div className="gal-filter" role="tablist" aria-label="Filter photos">
            {categories.map((c) => (
              <button
                key={c.value}
                type="button"
                role="tab"
                aria-selected={cat === c.value}
                className={`gal-filter__btn${cat === c.value ? ' is-active' : ''}`}
                onClick={() => setCat(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <motion.div
            key={cat}
            className="gal-grid"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            animate={reduce ? false : 'show'}
          >
            {visible.map((p, i) => (
              <motion.button
                key={p.src}
                type="button"
                className="gal-item"
                variants={gridItem}
                onClick={() => setActive(i)}
                aria-label={`View: ${p.alt}`}
              >
                <img src={p.src} alt={p.alt} loading="lazy" />
                <span className="gal-item__zoom" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></svg>
                </span>
              </motion.button>
            ))}
          </motion.div>
        </div>
      </section>

      <AnimatePresence>
        {active !== null && visible[active] && (
          <motion.div
            className="gal-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="Image viewer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
          >
            <button className="gal-lightbox__close" onClick={close} aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <button
              className="gal-lightbox__nav gal-lightbox__nav--prev"
              onClick={(e) => { e.stopPropagation(); show(-1) }}
              aria-label="Previous"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <motion.figure
              className="gal-lightbox__figure"
              key={visible[active].src}
              initial={reduce ? false : { opacity: 0, scale: 0.97 }}
              animate={reduce ? false : { opacity: 1, scale: 1 }}
              transition={{ duration: 0.25, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
            >
              <img src={visible[active].src} alt={visible[active].alt} />
              <figcaption>{visible[active].alt}</figcaption>
            </motion.figure>
            <button
              className="gal-lightbox__nav gal-lightbox__nav--next"
              onClick={(e) => { e.stopPropagation(); show(1) }}
              aria-label="Next"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
