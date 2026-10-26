import RequireAuth from '@/web/components/RequireAuth.jsx'
import CourseOutline from '@/web/pages/portal/CourseOutline.jsx'

export const metadata = { title: 'Course outline' }

export default function Page() {
  return (
    <RequireAuth roles={['student']}>
      <CourseOutline />
    </RequireAuth>
  )
}
