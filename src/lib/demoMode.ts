// Live-demo switch. Dependency-free on purpose: imported by envCheck,
// schedulerFlag, auth, Server Actions, and server components alike.
// The public demo (docs/live-demo.md) sets DEMO_MODE=true; every real
// deployment leaves it unset, which must mean zero behaviour change.

export type UserRoleName = "ADMIN" | "PASTOR" | "OFFICE_ADMIN" | "AUDITOR" | "VIEWER" | "EVENT_ORGANISER"

export const DEMO_ERROR = "Disabled in the live demo"
export const DEMO_EMAIL_DOMAIN = "@demo.invalid"
export const DEMO_IMPORT_MAX_BYTES = 200 * 1024

// One-click logins shown on /login. Demo login only ever signs into these
// reserved-domain users, so a real deployment that sets DEMO_MODE by mistake
// (and has no such users) fails closed.
export const DEMO_LOGINS: ReadonlyArray<{ role: UserRoleName; label: string; email: string }> = [
  { role: "ADMIN", label: "Admin", email: `admin${DEMO_EMAIL_DOMAIN}` },
  { role: "PASTOR", label: "Pastor", email: `pastor${DEMO_EMAIL_DOMAIN}` },
  { role: "OFFICE_ADMIN", label: "Office Admin", email: `office${DEMO_EMAIL_DOMAIN}` },
  { role: "AUDITOR", label: "Auditor", email: `auditor${DEMO_EMAIL_DOMAIN}` },
  { role: "VIEWER", label: "Viewer", email: `viewer${DEMO_EMAIL_DOMAIN}` },
  { role: "EVENT_ORGANISER", label: "Event Organiser", email: `organiser${DEMO_EMAIL_DOMAIN}` },
]

export function isDemoMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEMO_MODE === "true"
}

export function isDemoEmail(email: string): boolean {
  return email.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)
}

// First statement of every blocked Server Action / route, before auth():
// the error leaks nothing, and keeping it first makes the guard trivially
// testable and impossible to bypass via an early-return path.
export function assertNotDemo(): { error: string } | null {
  return isDemoMode() ? { error: DEMO_ERROR } : null
}
