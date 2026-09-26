import "server-only"
// Server-only. Pushes published-event changes to an optional external website
// via an HMAC-signed webhook (contract: docs/event-webhook.md). Off unless
// WEBSITE_SYNC_URL + WEBSITE_SYNC_SECRET are set. Best-effort: callers await it
// (up to the 8s timeout) but a website outage must never break a CRM action.
// Imported only by server actions and Server Components — never reaches the
// client bundle.

import { createHmac, randomUUID } from "crypto"
import { logger } from "@/lib/logger"
import { prisma } from "@/lib/prisma"

export type WebsiteEventPayload = {
  crmId: number
  title: string
  description: string | null
  category: string
  kind: string
  date: string | null // ISO 8601, one-off only
  endDate: string | null // ISO 8601
  recurs: string | null // recurring only
  recursLabel: string | null
  startTime: string | null
  location: string | null
  isPublished: boolean
  registerUrl: string | null // CRM public page, set only when the event takes registrations
  imageUrl: string | null
  // Event.updatedAt, ISO 8601 ms precision. Lets the receiver drop a
  // stale snapshot that arrives after a newer one. Receivers skip only
  // strictly-older revisions — equal = same snapshot, re-applied on resync.
  revision: string
}

type EventForSync = {
  id: number
  title: string
  description: string | null
  category: string
  kind: string
  date: Date | null
  endDate: Date | null
  recurs: string | null
  recursLabel: string | null
  startTime: string | null
  location: string | null
  imageUrl: string | null
  isPublished: boolean
  slug: string
  ticketTypes: { id: number }[]
  images?: { kind: string }[]
  updatedAt: Date
}

// Columns the website needs. Shared by single-event sync and the resync-all backstop.
const SYNC_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  kind: true,
  date: true,
  endDate: true,
  recurs: true,
  recursLabel: true,
  startTime: true,
  location: true,
  imageUrl: true,
  isPublished: true,
  slug: true,
  ticketTypes: { select: { id: true } },
  images: { select: { kind: true } },
  updatedAt: true,
} as const

/**
 * Maps a CRM event onto the website-sync webhook payload.
 *
 * @param event - the event plus its ticket-type ids (see `EventForSync` select shape).
 * @returns the `WebsiteEventPayload` posted to the webhook receiver.
 *
 * `registerUrl` is set to `<base>/e/<slug>` only when the event has at least one
 * ticket type AND a base URL is resolvable; otherwise it is `null` (no tickets =
 * nothing to register for; no base URL = can't build an absolute link).
 *
 * Base URL reads `AUTH_URL` first (local dev), then `NEXTAUTH_URL` (prod Container
 * App inline env). Reading only `AUTH_URL` previously left `registerUrl` null in
 * production.
 */
export function buildEventPayload(event: EventForSync): WebsiteEventPayload {
  // Prod sets NEXTAUTH_URL (Container App inline env); local dev sets AUTH_URL.
  // Accept either — reading only AUTH_URL left registerUrl null in production.
  const base = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "")
  if (event.ticketTypes.length > 0 && !base) {
    logger.warn("[website-sync] AUTH_URL/NEXTAUTH_URL unset — registerUrl will be null", { eventId: event.id })
  }
  const registerUrl = event.ticketTypes.length > 0 && base ? `${base}/e/${event.slug}` : null
  return {
    crmId: event.id,
    title: event.title,
    description: event.description,
    category: event.category,
    kind: event.kind,
    date: event.date ? event.date.toISOString() : null,
    endDate: event.endDate ? event.endDate.toISOString() : null,
    recurs: event.recurs,
    recursLabel: event.recursLabel,
    startTime: event.startTime,
    location: event.location,
    isPublished: event.isPublished,
    registerUrl,
    // Pasted imageUrl wins; otherwise fall back to the uploaded-banner serve
    // route (Task 2) when one exists and a base URL is resolvable.
    imageUrl:
      event.imageUrl ||
      (base && event.images?.some((i) => i.kind === "BANNER")
        ? `${base}/api/events/${event.slug}/image/banner`
        : null),
    revision: event.updatedAt.toISOString(),
  }
}

// HMAC-SHA256 over `${timestamp}.${body}` (timestamp binds the signature to a moment,
// letting the receiver reject replays). Hex digest. Receivers must recompute it byte-for-byte.
//
// Receiver contract (enforced by the receiving website — NOT here;
// the sender cannot reject its own replays). The endpoint MUST:
//   1. reject requests where abs(time() - X-Sync-Timestamp) > 300s ( replay window), and
//   2. drop any `nonce` (in the signed body) it has already processed within that window
//      ( replay / idempotency) — without (2), a payload captured inside the
//      300s window still replays, and infra-level retries can double-apply.
export function signBody(timestamp: string, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
}

// Reject non-canonical IPv4 literal encodings that resolve to an IP but slip
// past the dotted-quad range check: bare integer (2130706433 = 127.0.0.1),
// hex (0x7f000001 / 0x7f.0.0.1), octal-octet (0177.0.0.1 — Number() misparses
// "0177" as 177 while the resolver reads octal 127), and short-dotted (127.1).
// A legitimate target is a DNS name or a canonical dotted-quad; the latter still
// runs through the private-range check.
function isNonCanonicalNumericHost(host: string): boolean {
  const parts = host.split(".")
  const looksNumericIp = /^0x/.test(host) || parts.every((p) => /^\d+$/.test(p))
  if (!looksNumericIp) return false
  const canonicalV4 =
    parts.length === 4 &&
    parts.every((p) => /^\d+$/.test(p) && (p === "0" || !p.startsWith("0")) && Number(p) <= 255)
  return !canonicalV4
}

function isPrivateOrReservedV4(host: string): boolean {
  const v4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/)
  if (!v4) return false
  const a = Number(v4[1])
  const b = Number(v4[2])
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    // CGNAT 100.64.0.0/10 — also used by overlay VPNs (e.g. Tailscale), so a
    // 100.x sync URL must not reach an internal VPN node.
    (a === 100 && b >= 64 && b <= 127) ||
    // Benchmarking range 198.18.0.0/15.
    (a === 198 && (b === 18 || b === 19))
  )
}

// SSRF guard: the sync target must be a public https URL. A misconfigured
// or compromised WEBSITE_SYNC_URL must not make the CRM POST signed payloads to
// loopback/private/link-local/metadata endpoints. Literal-IP check only — the
// expected value is a public DNS name; DNS-rebinding is out of scope here.
export function isAllowedSyncUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== "https:") return false
  // Strip trailing DNS-root dot(s) before every check. Without this,
  // `localhost.` slips past the localhost test AND `127.0.0.1.` slips past the
  // numeric/dotted-quad checks below (the empty last label breaks both regexes),
  // so the guard would post signed payloads to loopback.
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost")) return false
  if (isNonCanonicalNumericHost(host) || isPrivateOrReservedV4(host)) return false
  // Reject ALL IPv6 literals: the expected value is a public DNS name, and
  // abbreviated/IPv4-mapped forms (::ffff:127.0.0.1, fe9x link-local, ::)
  // evade prefix-based range checks.
  if (host.includes(":")) return false
  return true
}

// True only when both halves of the webhook pair are set — the UI hides the
// resync control otherwise, since sync is an opt-in integration.
export function isWebsiteSyncConfigured(): boolean {
  return !!process.env.WEBSITE_SYNC_URL && !!process.env.WEBSITE_SYNC_SECRET
}

// POST a signed payload. No-op when sync env is unset (feature disabled). Throws on
// transport/HTTP error so the caller can log — callers swallow it (best-effort).
async function postToWebsite(payload: object): Promise<void> {
  const url = process.env.WEBSITE_SYNC_URL
  const secret = process.env.WEBSITE_SYNC_SECRET
  if (!url && !secret) return // sync feature not configured at all — intentional, no-op
  if (!url || !secret) {
    // Exactly one of the pair is set — almost certainly a misconfiguration
    // (e.g. one env var typo'd or missed on deploy), not an intentional
    // disable. Warn instead of silently no-op'ing so it surfaces.
    logger.warn("[website-sync] misconfigured — only one of WEBSITE_SYNC_URL/WEBSITE_SYNC_SECRET is set, sync is disabled", {
      urlSet: !!url,
      secretSet: !!secret,
    })
    return
  }
  if (!isAllowedSyncUrl(url)) {
    throw new Error("Website sync blocked: WEBSITE_SYNC_URL is not a public https URL")
  }

  // Per-request idempotency + replay token, carried inside the signed
  // body so the existing signature covers it (no signature-format change).
  // The receiver dedups by this nonce: kills infra-level retry double-applies and
  // rejects captured-payload replays even within the timestamp window. Backward-
  // compatible — an older receiver ignores the unknown field, and upserts/deletes are
  // already idempotent by crmId so a missed dedup is harmless.
  const body = JSON.stringify({ ...payload, nonce: randomUUID() })
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = signBody(timestamp, body, secret)

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sync-Timestamp": timestamp,
      "X-Sync-Signature": signature,
    },
    body,
    // A stalled website must not hang the CRM action — errors are caught by
    // callers, but a hung socket would otherwise block the await indefinitely.
    signal: AbortSignal.timeout(8000),
    // Never follow redirects: a compromised/misconfigured target could 301 the
    // signed payload to an arbitrary host.
    redirect: "error",
  })
  if (!res.ok) throw new Error(`Website sync failed: ${res.status}`)
}

// Push one event's current state (upsert). Covers create, update, publish and
// unpublish — the website mirrors isPublished and hides drafts itself.
export async function syncEventToWebsite(eventId: number): Promise<void> {
  try {
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: SYNC_SELECT })
    if (!event) return
    await postToWebsite({ action: "upsert", event: buildEventPayload(event) })
  } catch (e) {
    logger.error("[website-sync] upsert failed", { error: e instanceof Error ? e.message : String(e) })
  }
}

// Tell the website to remove a deleted event.
export async function syncEventDeletion(crmId: number): Promise<void> {
  try {
    await postToWebsite({ action: "delete", crmId })
  } catch (e) {
    logger.error("[website-sync] delete failed", { error: e instanceof Error ? e.message : String(e) })
  }
}

// Backstop: re-push every event (e.g. after a missed webhook or a website restore).
// take: 500 is a safety cap — the parish has dozens of events.
const RESYNC_CONCURRENCY = 15
const RESYNC_LIMIT = 500
export async function resyncAllEvents(): Promise<{ synced: number; failed: number; truncated: boolean; disabled: boolean }> {
  // When sync is unconfigured, postToWebsite silently no-ops (resolves) — so a
  // naive count would report every event as "synced" when nothing was sent.
  // Signal disabled so the caller reports honestly instead.
  if (!isWebsiteSyncConfigured()) {
    logger.warn("[website-sync] resync requested but sync is disabled (WEBSITE_SYNC_URL/SECRET unset)")
    return { synced: 0, failed: 0, truncated: false, disabled: true }
  }
  const events = await prisma.event.findMany({ select: SYNC_SELECT, take: RESYNC_LIMIT, orderBy: { id: "asc" } })
  // A full result set means there may be more events beyond the cap that were
  // never resynced — surface it so the admin isn't told "all synced" falsely.
  const truncated = events.length === RESYNC_LIMIT
  if (truncated) {
    logger.warn("[website-sync] resync hit the event cap — events beyond it were not synced", { cap: RESYNC_LIMIT })
  }
  let synced = 0
  let failed = 0
  // Process in concurrent batches rather than one-at-a-time: a serial loop is
  // (event count × 8s timeout) worst case (~4000s at the 500 cap), which would
  // hang the admin action. Batching bounds wall time to (batches × 8s) while
  // capping simultaneous in-flight requests to the website.
  for (let i = 0; i < events.length; i += RESYNC_CONCURRENCY) {
    const batch = events.slice(i, i + RESYNC_CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map((event) => postToWebsite({ action: "upsert", event: buildEventPayload(event) }))
    )
    results.forEach((r, j) => {
      if (r.status === "fulfilled") {
        synced++
      } else {
        logger.error("[website-sync] resync failed for event", { eventId: batch[j].id, error: r.reason instanceof Error ? r.reason.message : String(r.reason) })
        failed++
      }
    })
  }
  return { synced, failed, truncated, disabled: false }
}
