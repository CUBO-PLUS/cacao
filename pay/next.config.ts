import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

// This project's folder. Next otherwise picks a workspace root from the lockfiles it finds.
const raiz = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Serve the slashed form the host already redirects to, instead of bouncing back.
  trailingSlash: true,
  turbopack: {
    root: raiz,
  },
  // Plain security headers on every route. No Content-Security-Policy here.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
  // The admin panel used to live at /monitor. Old links still land on it.
  async redirects() {
    return [
      { source: '/monitor', destination: '/admin', permanent: false },
      { source: '/monitor/:ruta*', destination: '/admin/:ruta*', permanent: false },
    ];
  },
};

export default nextConfig;
