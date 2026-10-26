import RequireAuth from '@/web/components/RequireAuth.jsx'
import Notices from '@/web/pages/portal/Notices.jsx'

export const metadata = { title: 'Notices' }

export default function Page() {
  return (
    <RequireAuth roles={['student']}>
      <Notices />
    </RequireAuth>
  )
}
