'use client'
import { Navigate, useLocation } from '@/lib/router'
import { useAuth } from '../lib/auth.jsx'
import { Loading } from './portal/ui.jsx'

// Gates the portal. `roles` limits a route to students (applicants see a reduced portal).
export default function RequireAuth({ children, roles }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="container"><Loading /></div>
  if (!user) return <Navigate to={`/portal/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/portal" replace />
  return children
}
