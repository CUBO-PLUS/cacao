import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

// This project's folder. Next otherwise picks a workspace root from the lockfiles it finds.
const raiz = path.dirname(fileURLToPath(import.meta.url));

// A UUID is the only id a product or shop can have. Anything else can never be a row, so it is
// sent to a path that does not exist: Next answers that with a real 404 status, before any
// streaming starts (a notFound() in the page would come after the 200 is already sent).
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
// The host redirects onto a trailing slash. `$` would then miss a real UUID and the
// rewrite below would send the product page to the 404.
const ID_NO_UUID = `(?!${UUID}(?=/|$))[^/]+`;

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Serve the slashed form the host already redirects to, instead of bouncing back.
  trailingSlash: true,
  turbopack: {
    root: raiz,
  },
  // Response headers for every route. No Content-Security-Policy here.
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
  async rewrites() {
    return [
      { source: `/productos/:id(${ID_NO_UUID})`, destination: '/no-existe' },
      { source: `/negocios/:id(${ID_NO_UUID})`, destination: '/no-existe' },
      { source: `/servicios/:id(${ID_NO_UUID})`, destination: '/no-existe' },
      { source: `/necesito/:id((?!nuevo(?=/|$))${ID_NO_UUID})`, destination: '/no-existe' },
    ];
  },
};

export default nextConfig;
