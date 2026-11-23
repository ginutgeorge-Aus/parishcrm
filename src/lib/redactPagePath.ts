import { TOKEN_ROUTES } from "@/lib/tokenRoutes"

// Public routes whose last path segment is a bearer token (list in
// tokenRoutes.ts, parity-tested against csp.ts). Anyone holding the token can
// use the page, so it must never reach logs, GitHub issues or emails. Pure and
// client-safe. Anchored to the path start; group 1 is the literal route prefix.
const TOKEN_ROUTE_RES: RegExp[] = TOKEN_ROUTES.map((r) => new RegExp(`^(${r.prefix})[^/?#]+`))

/**
 * Replace the bearer-token segment of a public token route with `[token]`
 * (e.g. `/venue/abc` becomes `/venue/[token]`). Other paths are unchanged.
 */
export function redactPagePath(path: string): string
export function redactPagePath(path: string | undefined): string | undefined
export function redactPagePath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  for (const re of TOKEN_ROUTE_RES) {
    if (re.test(path)) return path.replace(re, "$1[token]")
  }
  return path
}
