// Public routes whose last path segment is a bearer token (see csp.ts
// isPublicPath). Anyone holding the token can use the page, so it must never
// reach logs, GitHub issues or emails. Pure and client-safe.
const TOKEN_ROUTES: RegExp[] = [
  /^(\/venue\/)[^/?#]+/,
  /^(\/family\/update\/)[^/?#]+/,
  /^(\/e\/[^/?#]+\/crew\/)[^/?#]+/,
]

/**
 * Replace the bearer-token segment of a public token route with `[token]`
 * (e.g. `/venue/abc` becomes `/venue/[token]`). Other paths are unchanged.
 */
export function redactPagePath(path: string): string
export function redactPagePath(path: string | undefined): string | undefined
export function redactPagePath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  for (const re of TOKEN_ROUTES) {
    if (re.test(path)) return path.replace(re, "$1[token]")
  }
  return path
}
