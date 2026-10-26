import Protected from '@/admin/components/Protected.jsx'
import Finance from '@/admin/pages/Finance.jsx'

export const metadata = { title: 'Payments & fees' }

export default function Page() {
  return (
    <Protected superOnly>
      <Finance />
    </Protected>
  )
}
