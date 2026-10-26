import RequireAuth from '@/web/components/RequireAuth.jsx'
import Materials from '@/web/pages/portal/Materials.jsx'

export const metadata = { title: 'Learning materials' }

export default function Page() {
  return (
    <RequireAuth roles={['student']}>
      <Materials />
    </RequireAuth>
  )
}
