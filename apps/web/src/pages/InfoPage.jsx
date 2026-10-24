import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'

export default function InfoPage({ eyebrow, title, intro }) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} intro={intro} />
      <section className="section">
        <div className="container stack">
          <p className="muted">Content for this page will be supplied by the academy.</p>
          <Button to="/contact" variant="outline">Ask us a question</Button>
        </div>
      </section>
    </>
  )
}
