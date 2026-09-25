import { isPublicPath } from "@/lib/csp"

// The ONLY paths an EVENT_ORGANISER may reach. Everything else redirects to
// /my-events. The CSV-export API and the print page are allowed here because
// they self-gate on EventManager membership (canManageEvent) — middleware only
// needs to let the request through to that check.
export function isOrganiserAllowedPath(pathname: string): boolean {
  if (pathname === "/my-events" || pathname.startsWith("/my-events/")) return true
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true
  if (pathname.startsWith("/_next")) return true
  if (pathname === "/api/health") return true

  // Public paths that organisers can access, but exclude the public register/waitlist APIs
  if (isPublicPath(pathname)) {
    // Block the public event register and waitlist endpoints (they are public to unauth users
    // but organisers shouldn't hit them directly — they use the web UI)
    if (pathname.startsWith("/api/events/") && (pathname.endsWith("/register") || pathname.endsWith("/waitlist"))) {
      return false
    }
    return true
  }

  // Membership-gated export + print entry points (self-gated downstream).
  if (pathname.startsWith("/api/events/") && pathname.endsWith("/export-csv")) return true
  if (pathname.startsWith("/events/") && pathname.endsWith("/registrations/print")) return true
  return false
}
