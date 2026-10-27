import { Suspense } from 'react'
import Signup from '@/web/pages/portal/Signup.jsx'

export const metadata = { title: 'Create your account', robots: { index: false } }

export default function Page() {
  // Reads the query string (useSearchParams), which needs its own Suspense boundary.
  return (
    <Suspense fallback={null}>
      <Signup />
    </Suspense>
  )
}
