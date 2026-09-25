// Content-Security-Policy helpers shared by middleware.
// Kept free of next-auth imports so it can be unit-tested in isolation.

// Routes that do not require authentication. Mirrors the public routes the
// old middleware matcher excluded; used by middleware to decide redirects now
// that the matcher runs on every route so CSP can be applied everywhere.
// Matching is exact or segment-bounded (prefix + "/") — "/loginX" and
// "/api/healthcheck" are NOT public, and only the register endpoint under
// /api/events/ is exposed, not every future sub-route.
const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/privacy", // Privacy Act: policy must be reachable without an account
  "/api/health",
  "/api/cron/send-reminders", // cron-only; gated by CRON_SECRET bearer, not a session
  "/api/cron/sweep-checkouts", // cron-only; gated by CRON_SECRET bearer, not a session
  "/api/cron/send-celebrations", // cron-only; gated by CRON_SECRET bearer, not a session
  "/api/cron/error-issues", // cron-only; gated by CRON_SECRET bearer, not a session
  "/api/stripe/webhook", // Stripe-only; gated by webhook signature verification, not a session

  // PWA assets — iOS/browser fetch these unauthenticated (e.g. on the login
  // screen or from the home-screen launcher), so they must bypass the auth gate.
  "/manifest.webmanifest",
  "/apple-icon",
  "/icon",

  // Static public/robots.txt — crawlers fetch this unauthenticated. Without a
  // bypass they get a 302-to-login instead of the Disallow-all file.
  "/robots.txt",
]
const PUBLIC_TREES = [
  "/api/auth", // NextAuth handlers — all sub-routes are auth plumbing
  "/api/branding", // Branding asset routes — logo, crest, etc. served publicly with ETag caching
  // Public membership registration form: /membershipform + /membershipform/success.
  // Submit is a server action guarded by Turnstile + rate-limit (no API route).
  "/membershipform",
]
// Public event pages: /e/[slug], /e/[slug]/success, /e/[slug]/crew/[token]
// (the token-gated volunteer view). Bare "/e" stays gated, and — unlike
// the old broad /^\/e\// — any OTHER sub-path (e.g. a future /e/[slug]/edit or
// /e/admin) is NOT auto-public: new routes under /e/ must be added here
// deliberately rather than silently inheriting the public bypass.
const PUBLIC_EVENT_PAGES = /^\/e\/[^/]+(?:\/success|\/crew\/[^/]+)?$/
// Public event API endpoints: /api/events/[slug]/register, /waitlist, and
// image/(banner|poster). Other /api/events/* routes (e.g. export-csv) carry
// their own auth() checks and stay behind the middleware gate.
const PUBLIC_EVENT_API = /^\/api\/events\/[^/]+\/(register|waitlist|image\/(banner|poster))$/
// The public image serve route must be embeddable cross-origin (the external
// website calendar renders <img> from it) — middleware relaxes CORP to
// cross-origin for exactly this path. Image bytes carry no PII, so relaxing
// CORP here has no confidentiality cost.
export const EVENT_IMAGE_PATH = /^\/api\/events\/[^/]+\/image\/(banner|poster)$/
// Public family self-update form: /family/update/[token]. Bare "/family" stays
// gated — only the token-scoped update path is exposed (no API route; submit is
// a server action validated by the hashed token).
const PUBLIC_FAMILY_UPDATE = /^\/family\/update\/[^/]+$/

// Static security headers applied to every dynamic response by middleware
// (AUDIT-054). next.config `headers()` does not reach App-Router Route
// Handlers, so API responses previously shipped without these; middleware runs
// on every non-static route (see matcher) and is the single source now.
// CSP is set per-request alongside these (it needs a nonce).
export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // camera=(self): the event check-in page scans registration QR codes
  // via getUserMedia. Restricted to our own origin — no cross-origin frame gets
  // the camera. microphone/geolocation stay fully disabled.
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  // Cross-origin isolation (ZAP 90004). COOP severs the opener link so a
  // cross-origin page that opens us can't reach our window (XS-Leaks / reverse
  // tabnabbing); CORP stops other origins embedding our responses as subresources.
  // Cross-Origin-Embedder-Policy is deliberately omitted: `require-corp` demands a
  // CORP/CORS header on every subresource, which would block the external event
  // images allowed by CSP `img-src https:` — not worth it for a low finding.
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
}

export function isPublicPath(pathname: string): boolean {
  // Strip a trailing slash so "/login/" matches "/login" and can't slip
  // past the allowlist as a distinct string. Next.js already resolves
  // "."/".." dot-segments in nextUrl.pathname before middleware sees it, and
  // percent-encoded traversal (e.g. %2e%2f) stays encoded — neither matches a
  // public pattern, so any un-normalized path fails safe (stays gated) and never
  // opens a protected route. Root "/" is left as-is.
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.replace(/\/+$/, "")
      : pathname
  return (
    PUBLIC_PATHS.includes(path) ||
    PUBLIC_TREES.some((p) => path === p || path.startsWith(`${p}/`)) ||
    PUBLIC_EVENT_PAGES.test(path) ||
    PUBLIC_EVENT_API.test(path) ||
    PUBLIC_FAMILY_UPDATE.test(path)
  )
}

// Build the CSP header value for a request. `'unsafe-eval'` is permitted only
// in development (Next.js HMR needs it); production relies on the nonce +
// `'strict-dynamic'`, which Next.js applies to its own bootstrap scripts.
//
// style-src: production drops `'unsafe-inline'` and uses the per-request
// nonce. Next.js auto-applies the nonce to the styles IT injects (next/font,
// framework), and our own `<style>` tags carry the nonce explicitly (the chart
// component via NonceProvider context, the print/report pages via headers()).
// Dev keeps `'unsafe-inline'` because HMR injects un-nonced styles.
// `style-src-attr 'unsafe-inline'` keeps element-level inline style attributes
// working (React `style={{}}` props, recharts' dynamic indicator colour) — a
// nonce cannot attach to a style attribute. Attribute styles can't `@import`
// or load external resources, so the high-risk vectors (injected `<style>`
// blocks, `@import` exfiltration) stay blocked by the nonce'd style-src.
export function buildCsp(nonce: string, isDev: boolean): string {
  // The nonce is interpolated straight into the header, so a value carrying a
  // space, quote, semicolon or newline would inject extra CSP directives (e.g.
  // "x' 'unsafe-inline") and defeat the policy. Callers always pass a
  // base64(UUID) string, so this only guards against future misuse — reject
  // anything outside the base64 / base64url alphabet, failing closed.
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) {
    throw new Error("buildCsp: nonce contains characters unsafe for a CSP header")
  }
  // Cloudflare Turnstile: the widget's api.js is loaded with the nonce,
  // renders in an iframe, and talks to challenges.cloudflare.com. Listing the
  // origin in script-src (belt-and-suspenders under strict-dynamic), frame-src,
  // and connect-src is inert when Turnstile is disabled — nothing embeds it.
  const TURNSTILE = "https://challenges.cloudflare.com"
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${TURNSTILE}${isDev ? " 'unsafe-eval'" : ""}`,
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${TURNSTILE}`,
    `frame-src ${TURNSTILE}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}
