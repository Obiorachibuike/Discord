/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(process.env.COVE_E2E ? { distDir: '.next-e2e' } : {}),
  allowedDevOrigins: ['127.0.0.1', 'localhost', ...(process.env.E2B_SANDBOX_ID ? [`3000-${process.env.E2B_SANDBOX_ID}.e2b.app`] : [])],
  transpilePackages: ['@cove/shared'],
  async headers() {
    // Development/HMR needs eval; production allows Next framework inline scripts but disallows external scripts.
    if (process.env.NODE_ENV !== 'production') return [];
    return [{ source: '/:path*', headers: [
      { key: 'Content-Security-Policy', value: [
        "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:", "font-src 'self' data:",
        "connect-src 'self' https: wss:", "media-src 'self' blob: https:", "worker-src 'self' blob:",
        "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
        'upgrade-insecure-requests'
      ].join('; ') },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000' }
    ] }];
  },
  // Vercel's REST rewrite. WebSockets require a same-origin reverse proxy or NEXT_PUBLIC_REALTIME_URL.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000'}/api/:path*` }];
  },
};
export default config;
