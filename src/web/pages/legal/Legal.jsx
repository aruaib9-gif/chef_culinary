'use client'
import { useParams, Link } from '@/lib/router'
import { site } from '@cca/shared/site'
import PageHeader from '../../components/ui/PageHeader.jsx'
import NotFound from '../NotFound.jsx'
import { legalPages, legalOrder, lastUpdated } from './legalContent.js'
import './Legal.css'

export default function Legal() {
  const { slug } = useParams()
  const page = legalPages[slug]
  if (!page) return <NotFound />

  return (
    <>
      <PageHeader eyebrow={page.eyebrow} title={page.title} intro={page.intro} />

      <section className="section">
        <div className="container legal">
          <article className="legal__body">
            <p className="legal__updated">Last updated: {lastUpdated}</p>

            {page.sections.map((s) => (
              <section key={s.heading} className="legal__section">
                <h2>{s.heading}</h2>
                {s.body.map((b, i) =>
                  typeof b === 'string'
                    ? <p key={i}>{b}</p>
                    : (
                      <ul key={i}>
                        {b.list.map((item, j) => <li key={j}>{item}</li>)}
                      </ul>
                    ),
                )}
              </section>
            ))}

            <section className="legal__section legal__contact">
              <h2>Contact us</h2>
              <p>If you have any questions about this policy, please get in touch:</p>
              <address>
                {site.address}<br />
                <a href={`tel:${site.phone}`}>{site.phone}</a><br />
                {site.emails.map((email) => (
                  <span key={email}><a href={`mailto:${email}`}>{email}</a><br /></span>
                ))}
              </address>
            </section>
          </article>

          <aside className="legal__aside">
            <div className="legal__aside-inner">
              <h3>Policies</h3>
              <ul>
                {legalOrder.map((key) => (
                  <li key={key}>
                    <Link to={`/legal/${key}`} className={key === slug ? 'is-active' : undefined}>
                      {legalPages[key].title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </section>
    </>
  )
}
