'use client'
import { Navigate, useLocation } from '@/lib/router'
import { useAuth } from '../lib/auth.jsx'
import { Loading } from './ui.jsx'

// Redirects to /admin/login without a staff session; super-admin-only pages bounce staff to the dashboard.
export default function Protected({ children, superOnly }) {
  const { user, loading, isSuper } = useAuth()
  const location = useLocation()
  if (loading) return <div className="login"><Loading /></div>
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (superOnly && !isSuper) return <Navigate to="/" replace />
  return children
}
