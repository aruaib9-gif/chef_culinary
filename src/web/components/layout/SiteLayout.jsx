'use client'
import { useEffect } from 'react'
import { useLocation } from '@/lib/router'
import Header from './Header.jsx'
import Footer from './Footer.jsx'
import FloatingActions from './FloatingActions.jsx'

export default function SiteLayout({ children }) {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <Header />
      <main id="main">
        {children}
      </main>
      <Footer />
      <FloatingActions />
    </>
  )
}
