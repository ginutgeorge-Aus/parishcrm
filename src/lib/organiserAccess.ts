import { isPublicPath } from "@/lib/csp"

// The ONLY paths an EVENT_ORGANISER may reach. Everything else redirects to
// /my-events. /my-classes pages self-gate on roll-marker membership
// (canMarkRoll). The CSV-export API and the print page are allowed here because
// they self-gate on EventManager membership (canManageEvent) — middleware only
// needs to let the request through to that check.
export function isOrganiserAllowedPath(pathname: string): boolean {
  if (pathname === "/my-events" || pathname.startsWith("/my-events/")) return true
  if (pathname === "/my-classes" || pathname.startsWith("/my-classes/")) return true
  // /my-groups pages self-gate on GroupLeaderAccess (canManageGroupMembers).
  if (pathname === "/my-groups" || pathname.startsWith("/my-groups/")) return true
  if (isConfinedInfraPath(pathname)) return true

  // Membership-gated export + print entry points (self-gated downstream).
  if (pathname.startsWith("/api/events/") && pathname.endsWith("/export-csv")) return true
  if (pathname.startsWith("/events/") && pathname.endsWith("/registrations/print")) return true
  return false
}

/**
 * Paths every confined login (EVENT_ORGANISER, TEACHER, HEADMASTER) needs:
 * auth, framework assets, health, and public pages — minus the public event
 * register/waitlist APIs (public to anonymous visitors, but a confined login
 * uses the web UI, not those endpoints directly).
 * @param pathname request pathname
 */
function isConfinedInfraPath(pathname: string): boolean {
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true
  if (pathname.startsWith("/_next")) return true
  if (pathname === "/api/health") return true
  if (isPublicPath(pathname)) {
    return !(pathname.startsWith("/api/events/") && (pathname.endsWith("/register") || pathname.endsWith("/waitlist")))
  }
  return false
}

/**
 * The ONLY paths a TEACHER may reach: /my-classes (pages self-gate per class on
 * canMarkRoll) plus confined infra. No /my-events or /my-groups; everything else
 * redirects to /my-classes.
 * @param pathname request pathname
 */
export function isTeacherAllowedPath(pathname: string): boolean {
  for (const root of ["/my-classes", "/account", "/help"]) {
    if (pathname === root || pathname.startsWith(`${root}/`)) return true
  }
  return isConfinedInfraPath(pathname)
}

/**
 * The ONLY paths a HEADMASTER may reach: /sunday-school, their own /account
 * (password, 2FA, passkeys) and /help, plus confined infra. Everything else
 * (people, accounting, every other API) redirects to /sunday-school.
 * @param pathname request pathname
 */
export function isHeadmasterAllowedPath(pathname: string): boolean {
  for (const root of ["/sunday-school", "/account", "/help"]) {
    if (pathname === root || pathname.startsWith(`${root}/`)) return true
  }
  return isConfinedInfraPath(pathname)
}
