import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AdminLayout from './components/AdminLayout.jsx'
import { Loading } from './components/ui.jsx'
import { useAuth, LookupsProvider } from './lib/auth.jsx'
import Login from './pages/Login.jsx'
import { ForgotPassword, ResetPassword } from './pages/PasswordPages.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Leads from './pages/Leads.jsx'
import Applications, { ApplicationDetail } from './pages/Applications.jsx'
import Students, { StudentDetail } from './pages/Students.jsx'
import Cohorts, { CohortDetail } from './pages/Cohorts.jsx'
import Programmes from './pages/Programmes.jsx'
import Results from './pages/Results.jsx'
import Attendance from './pages/Attendance.jsx'
import Learning from './pages/Learning.jsx'
import Finance from './pages/Finance.jsx'
import Certificates from './pages/Certificates.jsx'
import Messaging from './pages/Messaging.jsx'
import Requests from './pages/Requests.jsx'
import Reports from './pages/Reports.jsx'
import Settings from './pages/Settings.jsx'

// Redirects to /login without a staff session; super-admin-only pages bounce staff to the dashboard.
function Protected({ children, superOnly }) {
  const { user, loading, isSuper } = useAuth()
  const location = useLocation()
  if (loading) return <div className="login"><Loading /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (superOnly && !isSuper) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Protected><LookupsProvider><AdminLayout /></LookupsProvider></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="leads" element={<Leads />} />
        <Route path="applications" element={<Applications />} />
        <Route path="applications/:id" element={<ApplicationDetail />} />
        <Route path="students" element={<Students />} />
        <Route path="students/:id" element={<StudentDetail />} />
        <Route path="cohorts" element={<Cohorts />} />
        <Route path="cohorts/:id" element={<CohortDetail />} />
        <Route path="programmes" element={<Programmes />} />
        <Route path="results" element={<Results />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="learning" element={<Learning />} />
        <Route path="finance" element={<Protected superOnly><Finance /></Protected>} />
        <Route path="certificates" element={<Certificates />} />
        <Route path="messaging" element={<Messaging />} />
        <Route path="requests" element={<Requests />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<div className="panel"><h1>Page not found</h1></div>} />
      </Route>
    </Routes>
  )
}
