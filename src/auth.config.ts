import type { NextAuthConfig } from "next-auth"
import type { UserRole } from "@/lib/generated/prisma/enums"

// Edge-compatible auth config (no Node.js dependencies)
// Used by middleware for JWT validation only
export const authConfig: NextAuthConfig = {
  providers: [],
  pages: { signIn: "/login" },
  callbacks: {
    // Copy role + id from the JWT onto req.auth.user for middleware. The token
    // is written by auth.ts's Node jwtCallback (which has DB access); this Edge
    // config has no jwt callback, and NextAuth's default session shaping drops
    // custom claims — so without this, `req.auth.user.role` is undefined in
    // middleware and the EVENT_ORGANISER confinement never fires. Mirrors the
    // session callback in auth.ts. (type-only UserRole import → Edge-safe.)
    session({ session, token }) {
      if (session.user) {
        if (token.role) session.user.role = token.role as UserRole
        if (token.id) session.user.id = token.id as string
      }
      return session
    },
  },
  // Hard-force Secure session cookies in production (AUDIT-011). NextAuth
  // otherwise infers this from the AUTH_URL protocol, so a misconfigured http://
  // AUTH_URL would issue session cookies without the Secure flag / __Secure-
  // prefix. The e2e suite runs a production build over http://localhost, so it
  // opts out via E2E_ALLOW_TEST_OVERRIDES (set only by playwright.config.ts).
  useSecureCookies:
    process.env.NODE_ENV === "production" &&
    process.env.E2E_ALLOW_TEST_OVERRIDES !== "true",
  // No `callbacks.authorized` here: middleware.ts wraps `auth()` in its
  // own callback (`auth((req) => {...})`), so NextAuth only consults
  // `authorized`'s return value when it's a Response — a plain boolean is
  // silently discarded and never gates access. The real gate is
  // middleware.ts's own `!req.auth?.user && !isPublicPath(pathname)` check.
}
