import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Loading } from './components/portal/ui.jsx'
import SiteLayout from './components/layout/SiteLayout.jsx'
const PortalLayout = lazy(() => import('./components/layout/PortalLayout.jsx'))
import Home from './pages/Home.jsx'
import About from './pages/About.jsx'
import Admissions from './pages/Admissions.jsx'
const Apply = lazy(() => import('./pages/apply/Apply.jsx'))
import StudentLife from './pages/StudentLife.jsx'
import Careers from './pages/Careers.jsx'
import Events from './pages/Events.jsx'
import Gallery from './pages/Gallery.jsx'
import News from './pages/News.jsx'
import BlogPost from './pages/BlogPost.jsx'
import Programmes from './pages/Programmes.jsx'
import ProgrammeDetail from './pages/ProgrammeDetail.jsx'
import Contact from './pages/Contact.jsx'
import InfoPage from './pages/InfoPage.jsx'
import NotFound from './pages/NotFound.jsx'
const Verify = lazy(() => import('./pages/Verify.jsx'))
const Legal = lazy(() => import('./pages/legal/Legal.jsx'))
import RequireAuth from './components/RequireAuth.jsx'
const Login = lazy(() => import('./pages/portal/Login.jsx'))
const Signup = lazy(() => import('./pages/portal/Signup.jsx'))
const ForgotPassword = lazy(() => import('./pages/portal/ForgotPassword.jsx'))
const ResetPassword = lazy(() => import('./pages/portal/ResetPassword.jsx'))
const Dashboard = lazy(() => import('./pages/portal/Dashboard.jsx'))
const Results = lazy(() => import('./pages/portal/Results.jsx'))
const Payments = lazy(() => import('./pages/portal/Payments.jsx'))
const Timetable = lazy(() => import('./pages/portal/Timetable.jsx'))
const CourseOutline = lazy(() => import('./pages/portal/CourseOutline.jsx'))
const Materials = lazy(() => import('./pages/portal/Materials.jsx'))
const Assignments = lazy(() => import('./pages/portal/Assignments.jsx'))
const Notices = lazy(() => import('./pages/portal/Notices.jsx'))
const Certificates = lazy(() => import('./pages/portal/Certificates.jsx'))
const Requests = lazy(() => import('./pages/portal/Requests.jsx'))
const Profile = lazy(() => import('./pages/portal/Profile.jsx'))
import { infoPages } from './pages/infoPages.js'

export default function App() {
  // Portal, application and auth pages load on demand so the public site stays light on mobile data.
  return (
    <Suspense fallback={<div className="container"><Loading /></div>}>
    <Routes>
      <Route element={<SiteLayout />}>
        <Route index element={<Home />} />
        <Route path="about" element={<About />} />
        <Route path="admissions" element={<Admissions />} />
        <Route path="admissions/apply" element={<Apply />} />
        <Route path="student-life" element={<StudentLife />} />
        <Route path="careers" element={<Careers />} />
        <Route path="events" element={<Events />} />
        <Route path="gallery" element={<Gallery />} />
        <Route path="blog" element={<News />} />
        <Route path="blog/:slug" element={<BlogPost />} />
        <Route path="programmes" element={<Programmes />} />
        <Route path="programmes/:slug" element={<ProgrammeDetail />} />
        <Route path="contact" element={<Contact />} />
        <Route path="legal/:slug" element={<Legal />} />
        {infoPages.map((page) => (
          <Route key={page.path} path={page.path} element={<InfoPage {...page} />} />
        ))}
        <Route path="verify" element={<Verify />} />
        <Route path="portal/login" element={<Login />} />
        <Route path="portal/signup" element={<Signup />} />
        <Route path="portal/forgot-password" element={<ForgotPassword />} />
        <Route path="portal/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      {/* Student portal (spec §8). Applicants see their application; enrolled students get everything. */}
      <Route path="portal" element={<RequireAuth><PortalLayout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="profile" element={<Profile />} />
        {[
          ['results', <Results />],
          ['payments', <Payments />],
          ['timetable', <Timetable />],
          ['course-outline', <CourseOutline />],
          ['materials', <Materials />],
          ['assignments', <Assignments />],
          ['notices', <Notices />],
          ['certificates', <Certificates />],
          ['requests', <Requests />],
        ].map(([path, element]) => (
          <Route key={path} path={path} element={<RequireAuth roles={['student']}>{element}</RequireAuth>} />
        ))}
      </Route>
    </Routes>
    </Suspense>
  )
}
