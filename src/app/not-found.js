import { AuthProvider } from '@/web/lib/auth.jsx'
import SiteLayout from '@/web/components/layout/SiteLayout.jsx'
import NotFound from '@/web/pages/NotFound.jsx'

export default function NotFoundPage() {
  return (
    <AuthProvider>
      <SiteLayout>
        <NotFound />
      </SiteLayout>
    </AuthProvider>
  )
}
