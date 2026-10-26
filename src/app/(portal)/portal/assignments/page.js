import RequireAuth from '@/web/components/RequireAuth.jsx'
import Assignments from '@/web/pages/portal/Assignments.jsx'

export const metadata = { title: 'Assignments' }

export default function Page() {
  return (
    <RequireAuth roles={['student']}>
      <Assignments />
    </RequireAuth>
  )
}
