import { Suspense } from 'react'
import Link from 'next/link'

// Sign-in pages read ?next= and ?token= from the address, which needs a Suspense boundary.
export default function Layout({ children }) {
  return (
    <>
      <Link href="/" className="login-back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        Back to website
      </Link>
      <Suspense fallback={null}>{children}</Suspense>
    </>
  )
}
