import { Suspense } from 'react'
import { AuthProvider } from '@/web/lib/auth.jsx'
import RequireAuth from '@/web/components/RequireAuth.jsx'
import PortalLayout from '@/web/components/layout/PortalLayout.jsx'

export const metadata = { title: 'Student portal', robots: { index: false } }

// Applicants see their application; enrolled students get the full portal (spec §8).
export default function Layout({ children }) {
  return (
    <AuthProvider>
      <RequireAuth>
        <PortalLayout>
          <Suspense fallback={null}>{children}</Suspense>
        </PortalLayout>
      </RequireAuth>
    </AuthProvider>
  )
}
