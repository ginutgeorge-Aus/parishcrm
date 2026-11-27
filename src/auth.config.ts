import type { NextAuthConfig } from "next-auth"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { SESSION_MAX_AGE_SECONDS } from "@/lib/sessionWindows"

// Lean auth config (callbacks only, no Prisma/bcrypt). Used by middleware for JWT validation only;
// middleware runs on the Node runtime (see src/middleware.ts).
export const authConfig: NextAuthConfig = {
  providers: [],
  pages: { signIn: "/login" },
  // 7-day cookie life, matching auth.ts. Without it the middleware instance re-issues the cookie
  // with NextAuth's 30-day default (AUD-1-06). Shorter windows are enforced in auth.ts's jwtCallback.
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  callbacks: {
    // Copy role + id from the JWT onto req.auth.user for middleware. The token
    // is written by auth.ts's Node jwtCallback (which has DB access); this lean
    // config has no jwt callback, and NextAuth's default session shaping drops
    // custom claims — so without this, `req.auth.user.role` is undefined in
    // middleware and the EVENT_ORGANISER confinement never fires. Mirrors the
    // session callback in auth.ts.
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
