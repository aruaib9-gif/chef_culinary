'use client'
import { useState } from 'react'
import { Link } from '@/lib/router'
import { motion, useReducedMotion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import Reveal from '../components/ui/Reveal.jsx'
import { posts, postCategories } from './posts.js'
import { postCovers } from './postCovers.js'
import './News.css'

const EASE = [0.22, 1, 0.36, 1]

const filters = [{ value: 'all', label: 'All' },
  ...Object.entries(postCategories).map(([value, label]) => ({ value, label }))]

export default function News() {
  const reduce = useReducedMotion()
  const [cat, setCat] = useState('all')

  const visible = cat === 'all' ? posts : posts.filter((p) => p.category === cat)
  const [featured, ...rest] = visible

  const gridContainer = reduce
    ? {}
    : { hidden: {}, show: { transition: { staggerChildren: 0.08 } } }
  const gridItem = reduce
    ? {}
    : { hidden: { opacity: 0, y: 24, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE } } }

  return (
    <>
      <PageHeader
        eyebrow="News"
        title="Recipes, tips & news"
        intro="Chef tips, recipes and stories from the kitchen — to help you cook better, whatever your level."
      />

      <section className="section">
        <div className="container">
          <div className="news-filter" role="tablist" aria-label="Filter posts">
            {filters.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={cat === f.value}
                className={`news-filter__btn${cat === f.value ? ' is-active' : ''}`}
                onClick={() => setCat(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {featured && (
            <Reveal>
              <Link to={`/blog/${featured.slug}`} className="news-feature">
                <div className="news-feature__media">
                  <img src={postCovers[featured.slug]} alt="" loading="lazy" />
                </div>
                <div className="news-feature__body">
                  <span className="news-tag">{postCategories[featured.category]}</span>
                  <h2>{featured.title}</h2>
                  <p>{featured.excerpt}</p>
                  <span className="news-meta">{featured.readMins} min read</span>
                  <span className="news-feature__more">Read article →</span>
                </div>
              </Link>
            </Reveal>
          )}

          <motion.div
            key={cat}
            className="news-grid"
            variants={gridContainer}
            initial={reduce ? false : 'hidden'}
            animate={reduce ? false : 'show'}
          >
            {rest.map((p) => (
              <motion.article key={p.slug} className="news-card" variants={gridItem}>
                <Link to={`/blog/${p.slug}`} className="news-card__link">
                  <div className="news-card__media">
                    <img src={postCovers[p.slug]} alt="" loading="lazy" />
                  </div>
                  <div className="news-card__body">
                    <span className="news-tag">{postCategories[p.category]}</span>
                    <h3>{p.title}</h3>
                    <p>{p.excerpt}</p>
                    <span className="news-meta">{p.readMins} min read</span>
                  </div>
                </Link>
              </motion.article>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="section">
        <Reveal className="container news-sub">
          <h2>Get recipes & tips in your inbox</h2>
          <p>New articles and academy news, straight to you. No spam — just good food.</p>
          {/* TODO: POST to /api/leads with source "newsletter" + consent checkbox */}
          <form className="news-sub__form" onSubmit={(e) => e.preventDefault()}>
            <label htmlFor="news-email" className="visually-hidden">Email address</label>
            <input id="news-email" type="email" placeholder="Your email" required />
            <Button type="submit" variant="light">Subscribe</Button>
          </form>
        </Reveal>
      </section>
    </>
  )
}
