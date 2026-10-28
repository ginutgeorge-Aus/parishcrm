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

/** Timestamp (ms) of the last warning per message kind; absent = never. */
const lastWarnAt = new Map<string, number>()

/**
 * Logs a CLIENT_IP_HEADER warning at most once per `WARN_INTERVAL_MS` per process per kind, so one
 * kind of misconfiguration cannot hide another.
 * @param kind throttle key (e.g. "direct", "fallback")
 * @param message the warning text (header name only, never a request value)
 */
function warnConfiguredHeaderRateLimited(kind: string, message: string): void {
  const now = Date.now()
  const last = lastWarnAt.get(kind)
  if (last !== undefined && now - last < WARN_INTERVAL_MS) return
  lastWarnAt.set(kind, now)
  logger.warn(message)
}

/**
 * Rightmost entry of a (possibly comma-separated) header, trimmed: the one a trusted proxy appended.
 * An empty rightmost entry (`6.6.6.6,`) is NOT skipped: it means the value was passed through or
 * tampered with rather than appended by a trusted hop, so it yields undefined (untrusted).
 * @param h anything with `get`
 * @param name lower-case header name
 * @returns the entry, or undefined when the header is absent or its rightmost entry is empty
 */
function rightmostEntry(h: Pick<Headers, "get">, name: string): string | undefined {
  return h.get(name)?.split(",").at(-1)?.trim() || undefined
}

/**
 * Strips the `:port` from a `cloudfront-viewer-address` value (`ip:port`). Unbracketed IPv6 has no
 * bracket to delimit the port (`2600:1f18:abcd::1:46532`), so the final colon-separated group is cut
 * rather than read as a hextet. Bracketed values are left for `normalizeIp`.
 * @param value raw header entry (may be undefined)
 * @returns the value without its port
 */
function stripViewerPort(value: string | undefined): string | undefined {
  const v = value?.trim()
  if (!v || v.startsWith("[")) return v
  const i = v.lastIndexOf(":")
  return i === -1 ? v : v.slice(0, i)
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
 * instead. The rightmost entry is taken (port stripped for `cloudfront-viewer-address`), normalised via
 * `normalizeIp`, and accepted only when it is a well-formed IP. Falling back while the header is missing/unusable (proxied) or present
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
        "direct",
        `clientIp: CLIENT_IP_HEADER "${name}" is present but the request has no x-forwarded-for (origin reached directly?); ignoring it. The origin must not be reachable except through your proxy`,
      )
    }
    return undefined
  }
  const raw = rightmostEntry(h, name)
  const ip = normalizeIp(name === "cloudfront-viewer-address" ? stripViewerPort(raw) : raw)
  if (!ip) {
    warnConfiguredHeaderRateLimited("fallback", `clientIp: CLIENT_IP_HEADER "${name}" is missing or not a valid IP on a request; falling back to x-forwarded-for`)
  }
  return ip
}

/**
 * The single client-IP resolver: the `CLIENT_IP_HEADER` IP when configured and valid, else the
 * rightmost `x-forwarded-for` entry (appended by the trusted proxy; earlier entries are
 * attacker-controlled). Only a well-formed, canonicalised IP is returned: a crafted/odd value
 * (`unknown`, `evil:80`, an empty trailing entry) yields undefined so it never reaches
 * `AuditLog.ip`, a Turnstile `remoteip` or a rate-limit key. Callers needing a non-empty key
 * apply their own "unknown" fallback.
 * @param h anything with `get` (Server Components pass `await headers()`); null/undefined allowed
 * @returns the validated IP, or undefined
 */
export function clientIpOrUndefined(h?: Pick<Headers, "get"> | null): string | undefined {
  if (!h) return undefined
  return configuredHeaderIp(h) ?? normalizeIp(rightmostEntry(h, "x-forwarded-for"))
}

/**
 * Rate-limit key from a headers object: the validated IP when resolvable (see `clientIpOrUndefined`);
 * otherwise, on the default x-forwarded-for path only, the raw trimmed rightmost entry (so distinct
 * odd values do not collapse into one shared bucket, as before strict validation existed); else
 * "unknown". The raw value is a bucket key only, never persisted as an IP. A configured
 * `CLIENT_IP_HEADER` is never read raw.
 * @param h anything with `get`
 */
export function clientIpFromHeaders(h: Pick<Headers, "get">): string {
  return clientIpOrUndefined(h) ?? rightmostEntry(h, "x-forwarded-for") ?? "unknown"
}

/**
 * Client IP for rate-limiting keys (see `clientIpOrUndefined`); falls back to "unknown".
 * Typed against `Request` (the `NextRequest` supertype) so it accepts both; it only reads `headers`.
 * @param req the request
 */
export function getClientIp(req: Request): string {
  return clientIpFromHeaders(req.headers)
}
