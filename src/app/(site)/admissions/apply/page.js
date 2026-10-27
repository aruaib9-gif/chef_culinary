import { Suspense } from 'react'
import Apply from '@/web/pages/apply/Apply.jsx'

export const metadata = { title: 'Apply online' }

export default function Page() {
  // Reads the query string (useSearchParams), which needs its own Suspense boundary.
  return (
    <Suspense fallback={null}>
      <Apply />
    </Suspense>
  )
}
