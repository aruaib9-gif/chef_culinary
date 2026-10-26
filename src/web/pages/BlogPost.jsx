'use client'
import { Link, useParams } from '@/lib/router'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import Reveal from '../components/ui/Reveal.jsx'
import { getPost, postCategories, posts } from './posts.js'
import { postCovers } from './postCovers.js'
import NotFound from './NotFound.jsx'
import './News.css'

export default function BlogPost() {
  const { slug } = useParams()
  const post = getPost(slug)
  if (!post) return <NotFound />

  const more = posts.filter((p) => p.slug !== post.slug).slice(0, 3)

  return (
    <>
      <PageHeader eyebrow={postCategories[post.category]} title={post.title} />

      <section className="section">
        <article className="container post">
          <p className="post__meta">{post.readMins} min read</p>

          <Reveal className="post__cover">
            <img src={postCovers[post.slug]} alt="" />
          </Reveal>

          <div className="post__body">
            {post.body.map((para, i) => (
              <Reveal as="p" key={i} delay={i * 0.04}>{para}</Reveal>
            ))}
          </div>

          <div className="post__foot">
            <Link to="/blog" className="post__back">← All articles</Link>
            <Button to="/programmes">Explore programmes</Button>
          </div>
        </article>
      </section>

      {more.length > 0 && (
        <section className="section section--warm">
          <div className="container">
            <Reveal className="section__header">
              <span className="eyebrow">Keep reading</span>
              <h2>More from the kitchen</h2>
            </Reveal>
            <div className="news-grid">
              {more.map((p) => (
                <article key={p.slug} className="news-card">
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
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  )
}
