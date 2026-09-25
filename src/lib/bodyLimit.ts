/**
 * Returns true when a request body must be rejected as too large. App-Router
 * route handlers have no built-in body-size limit, so every size-limited route
 * calls this before reading the body.
 *
 * A missing or non-numeric Content-Length (e.g. `Transfer-Encoding: chunked`)
 * counts as "too large": the old inline guard did
 * `Number(req.headers.get("content-length")) > max`, but with no header that is
 * `Number(null)` = 0, and `0 > max` is false — so a chunked, length-less
 * request slipped through to an unbounded `req.json()` / `req.formData()` /
 * `file.arrayBuffer()` and buffered the whole body into heap → OOM.
 *
 * Legitimate callers of these routes (our own `fetch` with a string or
 * FormData body, and browsers posting a file) always send a Content-Length, so
 * rejecting its absence has no effect on real traffic.
 */
export function exceedsBodyLimit(req: Request, maxBytes: number): boolean {
  const header = req.headers.get("content-length")
  if (header === null || header.trim() === "") return true
  const len = Number(header)
  // A negative (or non-finite) Content-Length is malformed — treat it as
  // too-large so it can't slip a length-less/spoofed body past the guard.
  return !Number.isFinite(len) || len < 0 || len > maxBytes
}

// Public (unauthenticated) server actions — submitMembershipApplication,
// submitFamilyUpdate, startEventCheckout — share Next's global
// `serverActions.bodySizeLimit` (5mb, sized only for the admin-only event-image
// upload). Next has NO per-action override, so without this guard a public
// action buffers the full 5mb body before its own rate-limit/Zod runs.
// Middleware caps every public-path POST here, pre-buffer — the per-path
// override Next lacks — mirroring the route-handler `exceedsBodyLimit` guard.
// 1 MB clears every legitimate public body with headroom: Stripe webhook
// self-caps at 256 KB, membership signature ~300 KB, register/waitlist at 100 KB.
// Non-public (authenticated) actions like the image upload keep the 5mb cap —
// they never hit a public path so this guard skips them.
export const MAX_PUBLIC_BODY_BYTES = 1024 * 1024

export function publicBodyTooLarge(method: string, isPublic: boolean, req: Request): boolean {
  return method === "POST" && isPublic && exceedsBodyLimit(req, MAX_PUBLIC_BODY_BYTES)
}
