import { Suspense } from 'react'
import { LookupsProvider } from '@/admin/lib/auth.jsx'
import Protected from '@/admin/components/Protected.jsx'
import AdminLayout from '@/admin/components/AdminLayout.jsx'

export default function Layout({ children }) {
  return (
    <Protected>
      <LookupsProvider>
        <AdminLayout>
          <Suspense fallback={null}>{children}</Suspense>
        </AdminLayout>
      </LookupsProvider>
    </Protected>
  )
}
