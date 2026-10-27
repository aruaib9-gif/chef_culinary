import { Suspense } from 'react'
import Verify from '@/web/pages/Verify.jsx'

export const metadata = { title: 'Verify a certificate' }

export default function Page() {
  // Reads the query string (useSearchParams), which needs its own Suspense boundary.
  return (
    <Suspense fallback={null}>
      <Verify />
    </Suspense>
  )
}
