import RequireAuth from '@/web/components/RequireAuth.jsx'
import Payments from '@/web/pages/portal/Payments.jsx'

export const metadata = { title: 'Payments' }

export default function Page() {
  return (
    <RequireAuth roles={['student']}>
      <Payments />
    </RequireAuth>
  )
}
