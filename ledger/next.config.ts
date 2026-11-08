import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

// This project's folder. Next otherwise picks a workspace root from the lockfiles it finds.
const raiz = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Same setting as pay/: pages are static shells with the data read at request time (connection()).
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: raiz,
  },
  // The validator reads the official schema files from esquemas/ at run time (validar.ts), so the file tracer
  // cannot see them. Ship them with every route, or the web emission would fail on Vercel.
  outputFileTracingIncludes: {
    "/**": ["./esquemas/**/*"],
  },
  // Every Cacao product answers /admin. Here the owner's view is the tablero itself.
  async redirects() {
    return [{ source: "/admin", destination: "/", permanent: false }];
  },
  // Security headers on every route. No Content-Security-Policy here.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
