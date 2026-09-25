import { isIP } from "node:net"

/**
 * Client IP for rate-limiting and audit trails. The rightmost `x-forwarded-for`
 * entry is appended by the trusted reverse proxy and is not spoofable by
 * the client; earlier entries are attacker-controlled. Falls back to "unknown".
 *
 * Typed against `Request` (the `NextRequest` supertype) so it accepts both — it
 * only reads `headers`.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const last = xff.split(",").at(-1)?.trim()
    if (last) return last
  }
  return "unknown"
}

/**
 * Client IP for AuditLog.ip: the rightmost `x-forwarded-for` entry, but only when
 * it is a well-formed IP — a crafted/misconfigured XFF value would otherwise
 * persist an arbitrary string that pollutes log analysis. Returns
 * undefined (not "unknown") so the audit row simply has no IP. Takes the
 * headers object so Server Components can pass `await headers()`.
 */
export function auditIpFromHeaders(h?: Pick<Headers, "get"> | null): string | undefined {
  const candidate = h?.get("x-forwarded-for")?.split(",").at(-1)?.trim()
  if (!candidate) return undefined
  return isIP(candidate) ? candidate : undefined
}
