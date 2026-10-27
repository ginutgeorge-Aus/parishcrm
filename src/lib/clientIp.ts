import { isIP } from "node:net"

// RFC 9110 field-name token (lower-cased). `Headers.get` throws a TypeError on anything else (e.g. a
// name with a space), which would abort IP resolution, so such names are rejected up front.
const HEADER_NAME_TOKEN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/

// Headers whose first entry is client-controlled: reading them via CLIENT_IP_HEADER would key the
// rate limit on a spoofable value, so they are never honoured (the default XFF path handles XFF).
const SPOOFABLE_HEADERS = new Set(["x-forwarded-for", "forwarded"])

// Headers some proxies set but others pass through from the client untouched. Still honoured (nginx
// commonly overwrites x-real-ip), but surfaced as a boot warning so the operator confirms it.
const PASSTHROUGH_HEADERS = new Set(["x-real-ip", "x-client-ip", "client-ip", "x-originating-ip", "x-cluster-client-ip"])

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
 * Whether `CLIENT_IP_HEADER` names a header that is only safe when the outermost proxy overwrites it
 * (e.g. `x-real-ip`). Used for the boot-time warning in `envCheck.collectEnvWarnings`.
 * @param raw the raw env value (may be undefined)
 * @returns true for a known passthrough-prone header name
 */
export function isPassthroughIpHeader(raw: string | undefined): boolean {
  return PASSTHROUGH_HEADERS.has(raw?.trim().toLowerCase() ?? "")
}

/** Set once the "configured header unusable" warning has fired, so it logs once per process. */
let warnedConfiguredHeaderMissing = false

/**
 * Rightmost non-empty, trimmed `x-forwarded-for` entry (the one the trusted proxy appended). Empty
 * entries are skipped so a trailing comma (`1.2.3.4,`) still yields `1.2.3.4`.
 * @param h anything with `get`
 * @returns the entry, or undefined when the header is absent or has no non-empty entries
 */
function rightmostXff(h: Pick<Headers, "get">): string | undefined {
  return h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean).at(-1)
}

/**
 * Normalises a candidate IP: trims, strips `[v6]`/`[v6]:port` brackets and an IPv4 `:port`, lowercases,
 * and unwraps IPv4-mapped IPv6 (`::ffff:1.2.3.4` becomes `1.2.3.4`).
 * @param value raw header entry (may be undefined)
 * @returns the canonical IP, or undefined when it is not a well-formed IP
 */
function normalizeIp(value: string | undefined): string | undefined {
  let v = value?.trim().toLowerCase()
  if (!v) return undefined
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(v)
  if (bracketed) v = bracketed[1]
  else {
    const v4Port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(v)
    if (v4Port) v = v4Port[1]
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v)
  if (mapped) v = mapped[1]
  return isIP(v) !== 0 ? v : undefined
}

/**
 * Client IP from the header named by the optional `CLIENT_IP_HEADER` env (e.g. `cf-connecting-ip`),
 * for proxies that append internal hops to `x-forwarded-for`. Read at call time. An invalid or
 * spoofable name (see `clientIpHeaderStatus`) is ignored. The rightmost non-empty entry is taken (so a
 * proxy that appends rather than overwrites still wins over a client-sent value), normalised via
 * `normalizeIp`, and accepted only when it is a well-formed IP. When the env is valid but the header
 * is missing/unusable, warns once per process (header name only, never the value) and returns undefined.
 * @param h anything with `get`
 * @returns the IP, or undefined when the env is unset/ignored or the header is missing/invalid
 */
function configuredHeaderIp(h: Pick<Headers, "get">): string | undefined {
  const raw = process.env.CLIENT_IP_HEADER
  if (clientIpHeaderStatus(raw) !== "ok") return undefined
  const name = raw!.trim().toLowerCase()
  const entry = h.get(name)?.split(",").map((s) => s.trim()).filter(Boolean).at(-1)
  const ip = normalizeIp(entry)
  if (!ip && !warnedConfiguredHeaderMissing) {
    warnedConfiguredHeaderMissing = true
    console.warn(`clientIp: CLIENT_IP_HEADER "${name}" is missing or not a valid IP on a request; falling back to x-forwarded-for`)
  }
  return ip
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
  return rightmostXff(h) || "unknown"
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
  return normalizeIp(rightmostXff(h))
}
