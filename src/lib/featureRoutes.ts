import { FEATURES_SETTING_KEY, parseOverrides, resolveFeatures, type FeatureKey } from "@/lib/features"

/**
 * Route → feature map for the middleware gate. Mirrors the segment layouts'
 * `requireFeature` calls (featureGuards.test.ts keeps the two in step), but
 * runs on every request, so client-side navigation inside an already-open
 * segment (which never re-renders its layout) is blocked too.
 * No DB import at module top, so it loads in tests/scripts without a DB.
 */
type Rule = { match: RegExp; feature: FeatureKey }

/**
 * Rule matching `p` and everything beneath it.
 * @param p path prefix without trailing slash
 * @param feature feature that must be on
 */
const prefix = (p: string, feature: FeatureKey): Rule => ({
  match: new RegExp(`^${p}(?:/|$)`),
  feature,
})

/** Every matching rule must be on: a child path inherits its parents' gates. */
const FEATURE_ROUTES: readonly Rule[] = [
  prefix("/events", "events"),
  { match: /^\/e\/[^/]+\/crew(?:\/|$)/, feature: "events" },
  // The exact /my-events home is deliberately NOT gated: its layout falls back
  // (redirect to /my-classes or a notice) instead of a 404 dead end. Everything
  // beneath it is, since that layout stays mounted on client navigation.
  { match: /^\/my-events\/[^/]/, feature: "events" },
  prefix("/memberships", "memberships"),
  prefix("/membershipform", "memberships"),
  prefix("/sunday-school", "sundaySchool"),
  prefix("/my-classes", "sundaySchool"),
  prefix("/welcome-letter", "welcomeLetter"),
  prefix("/people/clearances", "clearances"),
  prefix("/people/birthdays", "celebrations"),
  prefix("/people/anniversaries", "celebrations"),
  prefix("/families/updates", "familyUpdates"),
  prefix("/family", "familyUpdates"),
  { match: /^\/families\/[^/]+\/giving(?:\/|$)/, feature: "accounting" },
  prefix("/accounting", "accounting"),
  prefix("/petty-cash", "pettyCash"),
  prefix("/accounting/petty-cash", "pettyCash"),
  prefix("/accounting/reconciliation", "reconciliation"),
  prefix("/accounting/reports/reconciliation", "reconciliation"),
  prefix("/accounting/import", "bankImport"),
  prefix("/accounting/dues", "dues"),
  prefix("/accounting/send-receipts", "receipts"),
  prefix("/accounting/receipt-audit", "receipts"),
  prefix("/accounting/dgr-receipts", "dgrReceipts"),
  prefix("/accounting/invoices", "invoices"),
  prefix("/accounting/customers", "invoices"),
  prefix("/accounting/budget", "budget"),
  prefix("/accounting/reports/budget-vs-actual", "budget"),
]

/**
 * Canonical form of a request pathname for rule matching: each segment
 * percent-decoded on its own (the router decodes, so `/%65vents` and `/events`
 * reach the same page), empty segments dropped (repeated/trailing slashes). A
 * malformed escape keeps only that segment raw. An encoded slash (`%2F`) stays
 * inside its segment instead of becoming a path separator.
 * @param pathname raw request pathname
 */
function normalisePath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean).map((seg) => {
    try {
      return decodeURIComponent(seg).replace(/\//g, "%2F")
    } catch {
      return seg
    }
  })
  return `/${segments.join("/")}`
}

/**
 * Features a page path depends on (empty when ungated).
 * @param pathname request pathname (percent-encoding, repeated and trailing slashes tolerated)
 */
export function featuresForPath(pathname: string): FeatureKey[] {
  const path = normalisePath(pathname)
  return FEATURE_ROUTES.filter((r) => r.match.test(path)).map((r) => r.feature)
}

/** Path the middleware rewrites a blocked request to: no such route, so the app 404 renders. */
export const FEATURE_OFF_REWRITE_PATH = "/_feature-off"

const TTL_MS = 5_000
let cache: { on: Set<FeatureKey> | null; at: number } | null = null
// Last successfully read set. Survives invalidation so a read failure right after
// a save still serves the previous set instead of failing open.
let lastKnown: Set<FeatureKey> | null = null
let inflight: Promise<Set<FeatureKey> | null> | null = null
// Bumped by invalidation so a read that started before it cannot repopulate the cache with stale data.
let generation = 0

/** One DB read; on failure logs, keeps serving the last known set (else null = fail open) and caches that for the TTL. */
async function loadFeatures(): Promise<Set<FeatureKey> | null> {
  const gen = generation
  try {
    const { prisma } = await import("@/lib/prisma")
    const row = await prisma.appSetting.findUnique({ where: { key: FEATURES_SETTING_KEY } })
    const on = resolveFeatures(parseOverrides(row?.value))
    lastKnown = on
    if (gen === generation) cache = { on, at: Date.now() }
    return on
  } catch (err) {
    // Error class only: driver messages can echo query values.
    console.error("[featureRoutes] feature settings read failed; using", lastKnown ? "last known set" : "fail-open", err instanceof Error ? err.name : "UnknownError")
    const on = lastKnown
    if (gen === generation) cache = { on, at: Date.now() }
    return on
  }
}

/**
 * Enabled features for the middleware, cached 5s per process (every request
 * passes through it). Concurrent callers share one read. On a read failure it
 * serves the last known set, or null (fail open) if there is none: a DB blip
 * must not 404 the whole app — layouts and actions still enforce per request.
 * The failure result is cached for the TTL so an outage is not hammered.
 */
export async function getEnabledFeaturesCached(): Promise<Set<FeatureKey> | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.on
  if (!inflight) {
    const read: Promise<Set<FeatureKey> | null> = loadFeatures().finally(() => {
      if (inflight === read) inflight = null
    })
    inflight = read
  }
  return inflight
}

/**
 * Drop this process's cached feature set so the next request re-reads it.
 * Called by `saveFeatures`. Only effective when the middleware shares this
 * module instance (dev, single bundle); a production build may bundle the
 * middleware separately, in which case it converges within the TTL instead.
 * The last known set is kept as the read-failure fallback.
 */
export function invalidateFeatureRouteCache(): void {
  generation++
  cache = null
  inflight = null
}

/** Test hook: drop the cached and last-known feature sets. */
export function _resetFeatureRoutesCache(): void {
  invalidateFeatureRouteCache()
  lastKnown = null
}

/**
 * True when `pathname` belongs to a feature that is currently off. Ungated
 * paths never touch the database.
 * @param pathname request pathname
 */
export async function isFeatureRouteOff(pathname: string): Promise<boolean> {
  const keys = featuresForPath(pathname)
  if (keys.length === 0) return false
  const on = await getEnabledFeaturesCached()
  return on !== null && keys.some((k) => !on.has(k))
}
