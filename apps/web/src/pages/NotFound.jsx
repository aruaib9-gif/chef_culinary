import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'

export default function NotFound() {
  return (
    <>
      <PageHeader eyebrow="404" title="Page not found" intro="The page you’re looking for doesn’t exist or has moved." />
      <section className="section">
        <div className="container">
          <Button to="/">Back to home</Button>
        </div>
      </section>
    </>
  )
}
