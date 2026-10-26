import { Suspense } from 'react'

// Sign-in pages read ?next= and ?token= from the address, which needs a Suspense boundary.
export default function Layout({ children }) {
  return <Suspense fallback={null}>{children}</Suspense>
}
