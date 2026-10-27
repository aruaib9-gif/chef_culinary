import { Suspense } from 'react'
import Login from '@/web/pages/portal/Login.jsx'

export const metadata = { title: 'Student sign in', robots: { index: false } }

export default function Page() {
  // Reads the query string (useSearchParams), which needs its own Suspense boundary.
  return (
    <Suspense fallback={null}>
      <Login />
    </Suspense>
  )
}
