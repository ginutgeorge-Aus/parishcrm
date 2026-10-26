import { isIP } from "node:net"

/**
 * Client IP from the header named by the optional `CLIENT_IP_HEADER` env (e.g. `cf-connecting-ip`),
 * for proxies that append internal hops to `x-forwarded-for`. Read at call time. The value is trimmed
 * (first entry if comma-separated) and accepted only when it is a well-formed IP.
 * @param h anything with `get`
 * @returns the IP, or undefined when the env is unset/blank or the header is missing/invalid
 */
function configuredHeaderIp(h: Pick<Headers, "get">): string | undefined {
  const name = process.env.CLIENT_IP_HEADER?.trim().toLowerCase()
  if (!name) return undefined
  const candidate = h.get(name)?.split(",")[0]?.trim()
  return candidate && isIP(candidate) ? candidate : undefined
}

/**
 * Client IP from a headers object (Server Components receive `await headers()`, not a Request): the
 * `CLIENT_IP_HEADER` header when that env is set and holds a valid IP, else the rightmost
 * `x-forwarded-for` entry (appended by the trusted proxy), else "unknown".
 * @param h anything with `get`
 */
export function clientIpFromHeaders(h: Pick<Headers, "get">): string {
  const configured = configuredHeaderIp(h)
  if (configured) return configured
  const last = h.get("x-forwarded-for")?.split(",").at(-1)?.trim()
  return last || "unknown"
}

/**
 * Client IP for rate-limiting and audit trails (see `clientIpFromHeaders`: optional `CLIENT_IP_HEADER`,
 * else the rightmost `x-forwarded-for` entry, which the trusted reverse proxy appends and the client
 * cannot spoof; earlier entries are attacker-controlled). Falls back to "unknown".
 *
 * Typed against `Request` (the `NextRequest` supertype) so it accepts both — it
 * only reads `headers`.
 */
export function getClientIp(req: Request): string {
  return clientIpFromHeaders(req.headers)
}

/**
 * Client IP for AuditLog.ip: the `CLIENT_IP_HEADER` IP when configured and valid, else the rightmost
 * `x-forwarded-for` entry, but only when it is a well-formed IP — a crafted/misconfigured XFF value
 * would otherwise persist an arbitrary string that pollutes log analysis. Returns
 * undefined (not "unknown") so the audit row simply has no IP. Takes the
 * headers object so Server Components can pass `await headers()`.
 */
export function auditIpFromHeaders(h?: Pick<Headers, "get"> | null): string | undefined {
  if (!h) return undefined
  const configured = configuredHeaderIp(h)
  if (configured) return configured
  const candidate = h.get("x-forwarded-for")?.split(",").at(-1)?.trim()
  if (!candidate) return undefined
  return isIP(candidate) ? candidate : undefined
}
