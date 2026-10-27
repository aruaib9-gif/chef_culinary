import { Suspense } from 'react'
import ResetPassword from '@/web/pages/portal/ResetPassword.jsx'

export const metadata = { title: 'Choose a new password', robots: { index: false } }

export default function Page() {
  // Reads the query string (useSearchParams), which needs its own Suspense boundary.
  return (
    <Suspense fallback={null}>
      <ResetPassword />
    </Suspense>
  )
}
