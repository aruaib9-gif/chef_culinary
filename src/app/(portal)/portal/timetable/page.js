import RequireAuth from '@/web/components/RequireAuth.jsx'
import Timetable from '@/web/pages/portal/Timetable.jsx'

export const metadata = { title: 'Timetable' }

export default function Page() {
  return (
    <RequireAuth roles={['student']}>
      <Timetable />
    </RequireAuth>
  )
}
