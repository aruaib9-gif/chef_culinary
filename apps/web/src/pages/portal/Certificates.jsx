import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import { fetchFile } from '../../lib/api.js'
import { date } from '../../lib/format.js'
import { PageHead, Loading, ErrorBox, Empty } from '../../components/portal/ui.jsx'

export default function Certificates() {
  const { data, error, loading, reload } = useApi('/student/certificates')
  const [dlError, setDlError] = useState(null)
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <div className="portal-page">
      <PageHead
        title="Certificates & documents"
        intro="Download your certificates. Each carries a verification code and QR code employers can check."
        actions={<button type="button" className="p-btn" onClick={() => fetchFile('/student/id-card.pdf').catch(setDlError)}>Student ID card (PDF)</button>}
      />
      <ErrorBox error={dlError} />
      {data.length === 0 ? (
        <Empty title="No certificate yet">Complete your programme, assessments and project work to earn your Certificate of Completion. Need a transcript or letter? <Link to="/portal/requests">Make a request</Link>.</Empty>
      ) : (
        <ul className="p-list">
          {data.map((c) => (
            <li key={c.id} className="p-list-item">
              <div>
                <div className="p-list-item__title">{c.title}</div>
                <div className="p-list-item__meta">Certificate {c.serial} · Issued {date(c.issued_on)}{c.grade ? ` · Grade ${c.grade}` : ''} · Verification code {c.verification_code}</div>
              </div>
              <button type="button" className="p-btn p-btn--primary" onClick={() => fetchFile(`/student/certificates/${c.id}/pdf`).catch(setDlError)}>Download PDF</button>
            </li>
          ))}
        </ul>
      )}
      <div className="card portal-cta-card">
        <div>
          <h2 className="portal-card-title">Verifying a certificate?</h2>
          <p className="muted">Employers can confirm a certificate by its number or code.</p>
        </div>
        <Link className="portal-link-btn" to="/verify">Verify a certificate</Link>
      </div>
    </div>
  )
}
