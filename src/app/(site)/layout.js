import { AuthProvider } from '@/web/lib/auth.jsx'
import SiteLayout from '@/web/components/layout/SiteLayout.jsx'

// No Suspense around every page: a page-wide boundary makes large pages stream as a hidden copy that can be left
// behind in the HTML. Pages that read the query string (useSearchParams) wrap themselves instead.
export default function Layout({ children }) {
  return (
    <AuthProvider>
      <SiteLayout>{children}</SiteLayout>
    </AuthProvider>
  )
}
