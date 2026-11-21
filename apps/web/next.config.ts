import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:4600';

const nextConfig: NextConfig = {
  // A second build (e.g. for tests against another API) can go to its own folder.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Self-contained server bundle for deployment (node .next/standalone/server.js).
  output: 'standalone',
  poweredByHeader: false,
  // The browser only talks to this origin; /api is forwarded to NestJS,
  // so auth cookies stay first-party and no CORS is needed.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
      // biometric machines (eSSL / ZKTeco ADMS push) always call /iclock/... on the server root
      { source: '/iclock/:path*', destination: `${API_URL}/api/iclock/:path*` },
    ];
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
    ];
  },
};

export default nextConfig;
