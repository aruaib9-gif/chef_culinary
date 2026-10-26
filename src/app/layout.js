import { Montserrat, Unbounded } from 'next/font/google'
import '@/shared/styles/index.css'

const body = Montserrat({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-montserrat', display: 'swap' })
const heading = Unbounded({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-unbounded', display: 'swap' })

export const metadata = {
  metadataBase: new URL(process.env.SITE_URL || 'http://localhost:3000'),
  title: { default: 'The Chefs Culinary Academy | Culinary School in Port Harcourt', template: '%s | The Chefs Culinary Academy' },
  description: 'Professional cookery programmes, short courses and sponsored cohorts at The Chefs Culinary Academy, Port Harcourt.',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    type: 'website',
    siteName: 'The Chefs Culinary Academy',
    title: 'The Chefs Culinary Academy',
    description: 'Professional cookery programmes, short courses and sponsored cohorts in Port Harcourt.',
  },
}

export const viewport = { themeColor: '#c2541b' }

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable}`}>
      <body>{children}</body>
    </html>
  )
}
