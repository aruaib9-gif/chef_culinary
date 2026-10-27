'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { galleryCategories, builtInPhotos } from '@cca/shared/gallery'
import PageHeader from '../components/ui/PageHeader.jsx'
import { api } from '../lib/api.js'
import './Gallery.css'

const EASE = [0.22, 1, 0.36, 1]

const categories = [{ value: 'all', label: 'All' }, ...Object.entries(galleryCategories).map(([value, label]) => ({ value, label }))]

// Shown only if the live gallery can't be reached.
const fallback = builtInPhotos.map((p) => ({ id: p.src, src: p.src, caption: p.caption, category: p.category }))

export default function Gallery() {
  const reduce = useReducedMotion()
  const [cat, setCat] = useState('all')
  const [active, setActive] = useState(null) // index into the visible list
  const [photos, setPhotos] = useState(null) // null while loading

  // Photos are managed in Admin → Website gallery.
  useEffect(() => {
    let alive = true
    api('/public/gallery')
      .then((rows) => { if (alive) setPhotos(Array.isArray(rows) ? rows : fallback) })
      .catch(() => { if (alive) setPhotos(fallback) })
    return () => { alive = false }
  }, [])

  const list = photos ?? []
  const usedCategories = categories.filter((c) => c.value === 'all' || list.some((p) => p.category === c.value))
  const visible = cat === 'all' ? list : list.filter((p) => p.category === cat)

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
            {usedCategories.map((c) => (
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

          {photos && visible.length === 0 && <p className="muted">No photos here yet.</p>}
          <motion.div
            key={cat}
            className="gal-grid"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            animate={reduce ? false : 'show'}
          >
            {visible.map((p, i) => (
              <motion.button
                key={p.id}
                type="button"
                className="gal-item"
                variants={gridItem}
                onClick={() => setActive(i)}
                aria-label={p.caption ? `View: ${p.caption}` : 'View photo'}
              >
                <img src={p.src} alt={p.caption} loading="lazy" />
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
              key={visible[active].id}
              initial={reduce ? false : { opacity: 0, scale: 0.97 }}
              animate={reduce ? false : { opacity: 1, scale: 1 }}
              transition={{ duration: 0.25, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
            >
              <img src={visible[active].src} alt={visible[active].caption} />
              {visible[active].caption && <figcaption>{visible[active].caption}</figcaption>}
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
