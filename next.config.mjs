/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  agentRules: false,
  // Loaded from node_modules at runtime instead of being bundled (they read their own data files from disk).
  serverExternalPackages: ['pdfkit', 'mongoose', 'mongodb-memory-server'],
  // Files the API reads with fs at runtime, so Vercel ships them with the functions.
  outputFileTracingIncludes: {
    '/api/**': ['./src/server/assets/**', './node_modules/pdfkit/js/data/**'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      { source: '/admin/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ]
  },
}

export default nextConfig
