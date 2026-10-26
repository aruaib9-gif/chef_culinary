import { AuthProvider } from '@/admin/lib/auth.jsx'
import '@/admin/admin.css'

export const metadata = {
  title: { default: 'Admin', template: '%s | CCA Admin' },
  robots: { index: false, follow: false },
}

export default function AdminRoot({ children }) {
  return <AuthProvider>{children}</AuthProvider>
}
