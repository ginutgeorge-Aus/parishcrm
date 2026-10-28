import { isIP } from "node:net"
import { logger } from "@/lib/logger"

// RFC 9110 field-name token (lower-cased). `Headers.get` throws a TypeError on anything else (e.g. a
// name with a space), which would abort IP resolution, so such names are rejected up front.
const HEADER_NAME_TOKEN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/

// Headers whose value is client-controlled or an append-list: reading them via CLIENT_IP_HEADER would
// key the rate limit on a spoofable value, so they are never honoured (the default XFF path handles
// x-forwarded-for itself).
const SPOOFABLE_HEADERS = new Set([
  "x-forwarded-for",
  "forwarded",
  "x-forwarded",
  "forwarded-for",
  "x-forwarded-client-ip",
  "x-original-forwarded-for",
])

// Headers some proxies set but others pass through from the client untouched. Still honoured (nginx
// commonly overwrites x-real-ip), but surfaced as a boot warning so the operator confirms it.
const PASSTHROUGH_HEADERS = new Set(["x-real-ip", "x-client-ip", "client-ip", "x-originating-ip", "x-cluster-client-ip"])

// Documented CDN/edge/proxy client-IP headers, which the platform overwrites on every request.
const KNOWN_CDN_HEADERS = new Set([
  "cf-connecting-ip",
  "true-client-ip",
  "fly-client-ip",
  "x-azure-clientip",
  "x-azure-socketip",
  "fastly-client-ip",
  "x-envoy-external-address",
  "x-appengine-user-ip",
  "cloudfront-viewer-address",
])

/** How `CLIENT_IP_HEADER` is classified; see {@link classifyClientIpHeader}. */
export type ClientIpHeaderKind = "unset" | "invalid" | "spoofable" | "passthrough" | "cdn" | "custom"

/**
 * Single classifier for the `CLIENT_IP_HEADER` env value, shared by the runtime lookup and the
 * boot-time check in `envCheck.collectEnvWarnings`. `unset`, `invalid` and `spoofable` values are
 * ignored at runtime; `passthrough`, `cdn` and `custom` are honoured.
 * @param raw the raw env value (may be undefined)
 * @returns the kind plus the trimmed, lower-cased header name (empty when unset)
 */
export function classifyClientIpHeader(raw: string | undefined): { kind: ClientIpHeaderKind; name: string } {
  const name = raw?.trim().toLowerCase() ?? ""
  if (!name) return { kind: "unset", name }
  if (!HEADER_NAME_TOKEN.test(name)) return { kind: "invalid", name }
  if (SPOOFABLE_HEADERS.has(name)) return { kind: "spoofable", name }
  if (PASSTHROUGH_HEADERS.has(name)) return { kind: "passthrough", name }
  if (KNOWN_CDN_HEADERS.has(name)) return { kind: "cdn", name }
  return { kind: "custom", name }
}

/** Minimum gap between "configured header unusable" warnings, so a misconfig cannot flood logs. */
const WARN_INTERVAL_MS = 10 * 60_000

/** Timestamp (ms) of the last "configured header unusable" warning; 0 = never. */
let lastConfiguredHeaderWarnAt = 0

/**
 * Logs a CLIENT_IP_HEADER warning at most once per `WARN_INTERVAL_MS` per process.
 * @param message the warning text (header name only, never a request value)
 */
function warnConfiguredHeaderRateLimited(message: string): void {
  const now = Date.now()
  if (lastConfiguredHeaderWarnAt && now - lastConfiguredHeaderWarnAt < WARN_INTERVAL_MS) return
  lastConfiguredHeaderWarnAt = now
  logger.warn(message)
}

/**
 * Rightmost non-empty, trimmed entry of a (possibly comma-separated) header, i.e. the one a trusted
 * proxy appended. Empty entries are skipped so a trailing comma (`1.2.3.4,`) still yields `1.2.3.4`.
 * @param h anything with `get`
 * @param name lower-case header name
 * @returns the entry, or undefined when the header is absent or has no non-empty entries
 */
function rightmostEntry(h: Pick<Headers, "get">, name: string): string | undefined {
  return h.get(name)?.split(",").map((s) => s.trim()).filter(Boolean).at(-1)
}

/**
 * Rightmost `x-forwarded-for` entry, normalised when it is a well-formed IP; otherwise the raw entry
 * is kept so odd values still key a bucket rather than collapsing to "unknown".
 * @param h anything with `get`
 * @returns the entry, or undefined when absent
 */
function rightmostXff(h: Pick<Headers, "get">): string | undefined {
  const raw = rightmostEntry(h, "x-forwarded-for")
  return normalizeIp(raw) ?? raw
}

/**
 * Normalises a candidate IP to one canonical spelling: trims, strips `[v6]`/`[v6]:port` brackets, an
 * IPv4 `:port` and (IPv6 only) a zone id, then canonicalises IPv6 via the WHATWG URL parser
 * (lower-case, zero-compressed) and unwraps IPv4-mapped addresses in any spelling
 * (`::ffff:1.2.3.4`, `0:0:0:0:0:ffff:1.2.3.4`, `::ffff:102:304` all become `1.2.3.4`).
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
  if (v.includes(":")) v = v.replace(/%[^\s%]+$/, "") // zone id (fe80::1%eth0) is only legal on IPv6
  const family = isIP(v)
  if (family === 4) return v
  if (family !== 6) return undefined
  let canonical: string
  try {
    canonical = new URL(`http://[${v}]/`).hostname.slice(1, -1)
  } catch {
    return undefined
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical)
  if (mapped) {
    const hi = parseInt(mapped[1], 16)
    const lo = parseInt(mapped[2], 16)
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  return canonical
}

/**
 * Client IP from the header named by the optional `CLIENT_IP_HEADER` env (e.g. `cf-connecting-ip`),
 * for proxies that append internal hops to `x-forwarded-for`. Read at call time. An invalid or
 * spoofable name (see `classifyClientIpHeader`) is ignored. The header is honoured only when the
 * request also carries `x-forwarded-for` (i.e. it traversed a proxy): a request without it reached the
 * origin directly, so the configured header is attacker-controlled and the default path is used
 * instead. The rightmost non-empty entry is taken, normalised via `normalizeIp`, and accepted only
 * when it is a well-formed IP. Falling back while the header is missing/unusable (proxied) or present
 * on a non-proxied request logs a rate-limited warning (header name only, never the value). Requests
 * with neither header (e.g. a local health check) do not warn.
 * @param h anything with `get`
 * @returns the IP, or undefined when the env is unset/ignored or the header is not usable
 */
function configuredHeaderIp(h: Pick<Headers, "get">): string | undefined {
  const { kind, name } = classifyClientIpHeader(process.env.CLIENT_IP_HEADER)
  if (kind === "unset" || kind === "invalid" || kind === "spoofable") return undefined
  const proxied = h.get("x-forwarded-for") != null
  const present = h.get(name) != null
  if (!proxied) {
    if (present) {
      warnConfiguredHeaderRateLimited(
        `clientIp: CLIENT_IP_HEADER "${name}" is present but the request has no x-forwarded-for (origin reached directly?); ignoring it. The origin must not be reachable except through your proxy`,
      )
    }
    return undefined
  }
  const ip = normalizeIp(rightmostEntry(h, name))
  if (!ip) {
    warnConfiguredHeaderRateLimited(`clientIp: CLIENT_IP_HEADER "${name}" is missing or not a valid IP on a request; falling back to x-forwarded-for`)
  }
  return ip
}

/**
 * Client IP, or undefined when the request carries none (no usable header/XFF entry). Prefer this over
 * comparing `clientIpFromHeaders` to the "unknown" sentinel: a literal `unknown` XFF entry is returned
 * as the string "unknown" (it still keys its own bucket), never confused with "no IP".
 * @param h anything with `get`
 * @returns the IP/key, or undefined when absent
 */
export function clientIpOrUndefined(h: Pick<Headers, "get">): string | undefined {
  return configuredHeaderIp(h) ?? rightmostXff(h)
}

/**
 * Client IP from a headers object (Server Components receive `await headers()`, not a Request): the
 * `CLIENT_IP_HEADER` header when that env is set and holds a valid IP, else the rightmost
 * `x-forwarded-for` entry (appended by the trusted proxy), else "unknown".
 * @param h anything with `get`
 */
export function clientIpFromHeaders(h: Pick<Headers, "get">): string {
  return clientIpOrUndefined(h) ?? "unknown"
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
  return configuredHeaderIp(h) ?? normalizeIp(rightmostEntry(h, "x-forwarded-for"))
}
