import RequireAuth from '@/web/components/RequireAuth.jsx'
import Requests from '@/web/pages/portal/Requests.jsx'

export const metadata = { title: 'Requests & feedback' }

export default function Page() {
  return (
    <RequireAuth roles={['student']}>
      <Requests />
    </RequireAuth>
  )
}
