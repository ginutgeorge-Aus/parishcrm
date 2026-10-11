/**
 * Open-redirect guard for the post-login `?next=` deep link. Pure and
 * Edge-safe (imported by both middleware and the client LoginForm).
 */

const MAX_LEN = 2000
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * Validate a user-supplied post-login target. Only a same-origin relative
 * path is accepted: it must start with a single "/", and contain no
 * backslashes, control characters (tab/newline are stripped by URL parsers,
 * turning "/\t/evil.com" into "//evil.com"), or scheme-like prefixes.
 * Anything else, and the login page itself (redirect loop), yields "/".
 *
 * @param raw - Untrusted value (typically a query-string param).
 * @returns A safe relative path, or "/" as the fallback.
 */
export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LEN) return "/"
  if (raw[0] !== "/" || raw[1] === "/") return "/"
  if (raw.includes("\\") || CONTROL_CHARS.test(raw)) return "/"
  // Belt and braces: resolving against a dummy origin must stay on that origin.
  try {
    const base = "http://x.invalid"
    if (new URL(raw, base).origin !== base) return "/"
  } catch {
    return "/"
  }
  const path = raw.split(/[?#]/, 1)[0]
  if (path === "/login" || path.startsWith("/login/")) return "/"
  return raw
}

/**
 * Build the middleware's unauthenticated redirect target, carrying the
 * requested location as `?next=` so login can return the user there.
 *
 * @param pathname - Requested pathname.
 * @param search - Requested query string including leading "?" (or "").
 * @returns "/login" or "/login?next=<encoded path>".
 */
export function loginRedirectPath(pathname: string, search: string): string {
  const target = pathname + search
  const safe = safeNextPath(target)
  if (safe === "/" || safe !== target) return "/login"
  return `/login?next=${encodeURIComponent(safe)}`
}
