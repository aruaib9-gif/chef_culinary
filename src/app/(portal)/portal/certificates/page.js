import RequireAuth from '@/web/components/RequireAuth.jsx'
import Certificates from '@/web/pages/portal/Certificates.jsx'

export const metadata = { title: 'Certificates' }

export default function Page() {
  return (
    <RequireAuth roles={['student']}>
      <Certificates />
    </RequireAuth>
  )
}
