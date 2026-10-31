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
// commonly overwrites x-real-ip; Cloudflare Free/Pro passes a client-sent true-client-ip through), but surfaced as a boot warning so the operator confirms it.
const PASSTHROUGH_HEADERS = new Set([
  "x-real-ip",
  "x-client-ip",
  "client-ip",
  "x-originating-ip",
  "x-cluster-client-ip",
  "true-client-ip",
  "x-envoy-external-address", // Envoy only sets it when it is the edge; behind another proxy a client value survives
  "x-azure-clientip", // Azure docs: derived from client-supplied XFF, so a user can overwrite it
  "x-azure-socketip", // socket peer as seen by Azure; not guaranteed to be the end client behind further hops
])

// Documented CDN/edge/proxy client-IP headers, which the platform overwrites on every request.
const KNOWN_CDN_HEADERS = new Set([
  "cf-connecting-ip",
  "fly-client-ip",
  "fastly-client-ip",
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

/** Timestamp (ms) of the last "falling back" warning; undefined = never. */
let lastWarnAt: number | undefined

/**
 * Logs the CLIENT_IP_HEADER "falling back" warning at most once per `WARN_INTERVAL_MS` per process.
 * @param message the warning text (header name only, never a request value)
 */
function warnConfiguredHeaderRateLimited(message: string): void {
  const now = Date.now()
  if (lastWarnAt !== undefined && now - lastWarnAt < WARN_INTERVAL_MS) return
  lastWarnAt = now
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
 * spoofable name (see `classifyClientIpHeader`) is ignored. A configured header is honoured whether
 * or not `x-forwarded-for` is present (many proxies set only e.g. `x-real-ip`); the origin must not
 * be reachable except through the proxy (see docs/environment.md). The rightmost entry is taken
 * (port stripped for `cloudfront-viewer-address`), normalised via `normalizeIp`, and accepted only
 * when it is a well-formed IP. Falling back while the header is unusable logs a rate-limited warning
 * (header name only, never the value); a request with neither it nor `x-forwarded-for` does not warn.
 * @param h anything with `get`
 * @returns the IP, or undefined when the env is unset/ignored or the header is not usable
 */
function configuredHeaderIp(h: Pick<Headers, "get">): string | undefined {
  const { kind, name } = classifyClientIpHeader(process.env.CLIENT_IP_HEADER)
  if (kind === "unset" || kind === "invalid" || kind === "spoofable") return undefined
  const raw = rightmostEntry(h, name)
  const ip = normalizeIp(name === "cloudfront-viewer-address" ? stripViewerPort(raw) : raw)
  // Stay quiet for a request carrying neither the header nor x-forwarded-for (e.g. a local health check).
  if (!ip && (h.get(name) != null || h.get("x-forwarded-for") != null)) {
    warnConfiguredHeaderRateLimited(`clientIp: CLIENT_IP_HEADER "${name}" is missing or not a valid IP on a request; falling back to x-forwarded-for`)
  }
  return ip
}

/**
 * The single client-IP resolver: the `CLIENT_IP_HEADER` IP when configured and valid, else the
 * rightmost `x-forwarded-for` entry (appended by the trusted proxy; earlier entries are
 * attacker-controlled). Only a well-formed, canonicalised IP is returned: a crafted/odd value
 * (`unknown`, `evil:80`, an empty trailing entry) yields undefined so it never reaches
 * `AuditLog.ip` or a validated-IP consumer. Rate limiters use the bucket key from
 * `resolveClientIp` / `clientIpFromHeaders`.
 * @param h anything with `get` (Server Components pass `await headers()`); null/undefined allowed
 * @returns the validated IP, or undefined
 */
export function clientIpOrUndefined(h?: Pick<Headers, "get"> | null): string | undefined {
  if (!h) return undefined
  return configuredHeaderIp(h) ?? normalizeIp(rightmostEntry(h, "x-forwarded-for"))
}

/**
 * Rate-limit bucket for a canonical IP: IPv4 as-is; IPv6 collapses to its /64 prefix (the first four
 * hextets of the expanded address, e.g. `2001:db8:1:2::/64`) because one subscriber typically controls
 * a whole /64 and could otherwise mint unlimited buckets.
 * @param ip a canonical IP from `normalizeIp`
 * @returns the bucket key
 */
function bucketFor(ip: string): string {
  if (!ip.includes(":")) return ip
  const [head, tail = ""] = ip.split("::")
  const headParts = head ? head.split(":") : []
  const tailParts = tail ? tail.split(":") : []
  const parts = ip.includes("::") ? [...headParts, ...Array<string>(8 - headParts.length - tailParts.length).fill("0"), ...tailParts] : headParts
  return `${parts.slice(0, 4).map((x) => parseInt(x, 16).toString(16)).join(":")}::/64`
}

/**
 * Resolves headers once into the validated IP (audit / Turnstile `remoteip`; undefined when none,
 * full canonical address) and the rate-limit bucket key (IPv4 as-is, IPv6 its /64 prefix, else
 * "unknown"). The two always agree on the trusted entry; resolve once per request and reuse both.
 * @param h anything with `get`
 * @returns the validated IP (or undefined) and the bucket key (never empty)
 */
export function resolveClientIp(h: Pick<Headers, "get">): { ip: string | undefined; key: string } {
  const ip = clientIpOrUndefined(h)
  return { ip, key: ip ? bucketFor(ip) : "unknown" }
}

/**
 * Rate-limit bucket key from a headers object (see `resolveClientIp`), "unknown" when none.
 * Every rate-limit caller must use this (or `rateKeyFromRequest`) so malformed entries behave the same
 * everywhere; `AuditLog.ip` uses `clientIpOrUndefined`.
 * @param h anything with `get`
 * @returns the bucket key (never empty)
 */
export function clientIpFromHeaders(h: Pick<Headers, "get">): string {
  return resolveClientIp(h).key
}

/**
 * Client IP as a rate-limit bucket key (see `clientIpFromHeaders`). Audit logs use
 * {@link auditIpFromRequest}. Typed against `Request` (the `NextRequest` supertype) so it accepts
 * both; it only reads `headers`.
 * @param req the request
 * @returns the bucket key (never empty)
 */
export function rateKeyFromRequest(req: Request): string {
  return clientIpFromHeaders(req.headers)
}

/**
 * Validated client IP for persistence (`AuditLog.ip`): a well-formed canonical IP or undefined, never
 * a raw header value. Typed against `Request` (the `NextRequest` supertype).
 * @param req the request
 * @returns the validated IP, or undefined
 */
export function auditIpFromRequest(req: Request): string | undefined {
  return clientIpOrUndefined(req.headers)
}
