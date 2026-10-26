import { Suspense } from 'react'
import { AuthProvider } from '@/web/lib/auth.jsx'
import SiteLayout from '@/web/components/layout/SiteLayout.jsx'

export default function Layout({ children }) {
  return (
    <AuthProvider>
      <SiteLayout>
        <Suspense fallback={null}>{children}</Suspense>
      </SiteLayout>
    </AuthProvider>
  )
}
