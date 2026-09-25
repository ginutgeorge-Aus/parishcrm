import NextAuth from "next-auth"
import { NextResponse } from "next/server"
import { authConfig } from "@/auth.config"
import { buildCsp, isPublicPath, SECURITY_HEADERS, EVENT_IMAGE_PATH } from "@/lib/csp"
import { publicBodyTooLarge } from "@/lib/bodyLimit"
import { isOrganiserAllowedPath } from "@/lib/organiserAccess"
import {
  getMaintenanceState,
  isMaintenanceBypassPath,
  renderMaintenanceHtml,
} from "@/lib/maintenance"

const { auth } = NextAuth(authConfig)

// Middleware now runs on every route (except static assets) so a per-request
// CSP nonce can be applied everywhere. Auth redirects, previously
// handled by the matcher excluding public routes, are done inline via
// isPublicPath.
export default auth(async (req) => {
  const { pathname } = req.nextUrl

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development")

  // Site-wide maintenance gate (flipped by deploy.yml around a release). Read a
  // DB-backed flag (5s cache, fail-open) and short-circuit everyone — including
  // admins and /login — to a self-contained 503 page. Health + framework assets
  // bypass so the deploy health-gate and this page's own styling still load.
  if (!isMaintenanceBypassPath(pathname)) {
    const maint = await getMaintenanceState()
    if (maint.enabled) {
      const res = new NextResponse(renderMaintenanceHtml(maint, nonce), {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": csp,
          "Retry-After": "60",
        },
      })
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v)
      return res
    }
  }

  const isPublic = isPublicPath(pathname)

  // Cap the body of every public (unauthenticated) POST before Next buffers it.
  // Public server actions share Next's global serverActions.bodySizeLimit (5mb,
  // sized for the admin image upload) with no per-action override, so this is
  // the per-path guard Next lacks — it rejects an oversized public-action body
  // pre-buffer, mirroring the route-handler exceedsBodyLimit checks.
  if (publicBodyTooLarge(req.method, isPublic, req)) {
    const res = new NextResponse("Payload too large", {
      status: 413,
      headers: { "Content-Security-Policy": csp },
    })
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v)
    return res
  }

  // Match the original authorized() gate exactly: logged in === a user on the
  // session. req.auth can be a non-null object without a user. The 302 carries
  // the CSP header too — it executes no scripts, but keeping the policy on
  // every response closes the defense-in-depth gap.
  if (!req.auth?.user && !isPublic) {
    const redirect = NextResponse.redirect(new URL("/login", req.nextUrl))
    redirect.headers.set("Content-Security-Policy", csp)
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) redirect.headers.set(k, v)
    return redirect
  }

  // Event organisers are confined to /my-events (+ membership-gated export/print
  // + public/auth/asset paths). Any other path redirects to their home, so a
  // hand-typed /people or /accounting URL never renders.
  if (req.auth?.user?.role === "EVENT_ORGANISER" && !isOrganiserAllowedPath(pathname)) {
    const redirect = NextResponse.redirect(new URL("/my-events", req.nextUrl))
    redirect.headers.set("Content-Security-Policy", csp)
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) redirect.headers.set(k, v)
    return redirect
  }

  // Set the nonce on the request headers so Next.js applies it to its own
  // bootstrap scripts, and the CSP on the response so the browser enforces it.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", csp)
  // Pathname only (no query string — matches the URL-redaction rule) so the
  // dashboard layout can record an aggregate route-view counter ( Phase 3).
  requestHeaders.set("x-pathname", req.nextUrl.pathname)

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set("Content-Security-Policy", csp)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v)
  // The public event-image route is embedded cross-origin by the external
  // website calendar; the global CORP: same-origin would make the browser
  // block that <img> load. Relax it to cross-origin for this path only
  // (public, non-PII image bytes). Set AFTER the loop so it wins.
  if (EVENT_IMAGE_PATH.test(pathname)) {
    res.headers.set("Cross-Origin-Resource-Policy", "cross-origin")
  }
  return res
})

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
