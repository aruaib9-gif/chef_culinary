import RequireAuth from '@/web/components/RequireAuth.jsx'
import Results from '@/web/pages/portal/Results.jsx'

export const metadata = { title: 'Results' }

export default function Page() {
  return (
    <RequireAuth roles={['student']}>
      <Results />
    </RequireAuth>
  )
}
