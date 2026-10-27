import { isIP } from "node:net"

// RFC 9110 field-name token (lower-cased). `Headers.get` throws a TypeError on anything else (e.g. a
// name with a space), which would abort IP resolution, so such names are rejected up front.
const HEADER_NAME_TOKEN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/

// Headers whose first entry is client-controlled: reading them via CLIENT_IP_HEADER would key the
// rate limit on a spoofable value, so they are never honoured (the default XFF path handles XFF).
const SPOOFABLE_HEADERS = new Set(["x-forwarded-for", "forwarded"])

/**
 * Why the `CLIENT_IP_HEADER` env value is ignored, if it is. Shared by the runtime lookup and the
 * boot-time warning in `envCheck.collectEnvWarnings`.
 * @param raw the raw env value (may be undefined)
 * @returns "unset" when unset/blank, "invalid" when not a legal header name, "spoofable" for
 *   `x-forwarded-for`/`forwarded`, or "ok"
 */
export function clientIpHeaderStatus(raw: string | undefined): "unset" | "invalid" | "spoofable" | "ok" {
  const name = raw?.trim().toLowerCase()
  if (!name) return "unset"
  if (!HEADER_NAME_TOKEN.test(name)) return "invalid"
  if (SPOOFABLE_HEADERS.has(name)) return "spoofable"
  return "ok"
}

/**
 * Client IP from the header named by the optional `CLIENT_IP_HEADER` env (e.g. `cf-connecting-ip`),
 * for proxies that append internal hops to `x-forwarded-for`. Read at call time. An invalid or
 * spoofable name (see `clientIpHeaderStatus`) is ignored. The value is trimmed (first entry if
 * comma-separated) and accepted only when it is a well-formed IP.
 * @param h anything with `get`
 * @returns the IP, or undefined when the env is unset/ignored or the header is missing/invalid
 */
function configuredHeaderIp(h: Pick<Headers, "get">): string | undefined {
  const raw = process.env.CLIENT_IP_HEADER
  if (raw === undefined || clientIpHeaderStatus(raw) !== "ok") return undefined
  const candidate = h.get(raw.trim().toLowerCase())?.split(",")[0]?.trim()
  return candidate && isIP(candidate) !== 0 ? candidate : undefined
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
  return isIP(candidate) !== 0 ? candidate : undefined
}
