import { clerkMiddleware } from "@clerk/nextjs/server";

// Runs before each page request. Clerk refreshes the session token when needed, so Server Components and
// actions see a valid one. It never redirects: the pages and routes decide that (src/servidor/acceso.ts).
export default clerkMiddleware();

// Static files skip the proxy: images, fonts, the manifest and Next's own assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|webmanifest)$).*)"],
};
