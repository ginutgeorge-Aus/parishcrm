import { FEATURES_SETTING_KEY, parseStoredOverrides, resolveFeatures, type FeatureKey } from "@/lib/features"
import {
  getSettingsSnapshot, invalidateSettingsSnapshot, settingsGeneration, type SettingsSnapshot,
} from "@/lib/settingsSnapshot"

/**
 * Route → feature map for the middleware gate. Mirrors the segment layouts'
 * `requireFeature` calls (featureGuards.test.ts keeps the two in step), but
 * runs on every request, so client-side navigation inside an already-open
 * segment (which never re-renders its layout) is blocked too.
 * No DB import at module top, so it loads in tests/scripts without a DB.
 */
export type Rule = { match: RegExp; feature: FeatureKey }

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
export const FEATURE_ROUTES: readonly Rule[] = [
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

/**
 * Where a blocked path sends the caller instead of the 404, or null for the 404.
 * `/my-events/*` goes back to the `/my-events` home, whose layout redirects an
 * organiser to `/my-classes` or shows the events-off notice, so a bookmarked or
 * emailed event link is not a dead end.
 * @param pathname request pathname (same normalisation as `featuresForPath`)
 */
export function featureOffRedirect(pathname: string): string | null {
  return /^\/my-events\/[^/]/.test(normalisePath(pathname)) ? "/my-events" : null
}

/** Path the middleware rewrites a blocked request to: no such route, so the app 404 renders. */
export const FEATURE_OFF_REWRITE_PATH = "/_feature-off"

// Last successfully resolved set. Survives invalidation so a read failure right after
// a save still serves the previous set instead of failing open.
let lastKnown: Set<FeatureKey> | null = null
// Resolved set per distinct stored value: a bad value is parsed (and warned about) once, not per refresh.
let resolved: { raw: string | null; on: Set<FeatureKey> } | null = null

/**
 * Resolve the stored features value, memoised by the raw string. A throw while
 * parsing a successfully read value is not a DB failure: fall back to the
 * registry defaults (memoised, logged once) instead of failing open forever.
 * @param raw stored `features` setting value
 */
function resolveStored(raw: string | null): Set<FeatureKey> {
  if (resolved && resolved.raw === raw) return resolved.on
  let on: Set<FeatureKey>
  try {
    on = resolveFeatures(parseStoredOverrides(raw))
  } catch (err) {
    console.error("[featureRoutes] stored features value unusable; using defaults", err instanceof Error ? err.name : "UnknownError")
    on = resolveFeatures({})
  }
  resolved = { raw, on }
  return on
}

/**
 * Enabled features for the middleware, via the shared 5s settings snapshot
 * (every request passes through it). On a read failure it serves the last
 * known set, or null (fail open) if there is none: a DB blip must not 404 the
 * whole app — layouts and actions still enforce per request. The snapshot
 * caches the failure briefly so an outage is not hammered.
 */
export async function getEnabledFeaturesCached(): Promise<Set<FeatureKey> | null> {
  const gen = settingsGeneration()
  let snap: SettingsSnapshot
  try {
    snap = await getSettingsSnapshot()
  } catch {
    return lastKnown // the snapshot already logged the failure
  }
  const on = resolveStored(snap[FEATURES_SETTING_KEY])
  // A read that started before an invalidation must not overwrite the fallback set.
  if (gen === settingsGeneration()) lastKnown = on
  return on
}

/**
 * Drop this process's cached settings so the next request re-reads them.
 * Called by `saveFeatures`. The settings snapshot is shared, so this also
 * drops the cached maintenance flag (harmless: one extra read). Only effective
 * when the middleware shares this module instance (dev, single bundle); a
 * production build may bundle the middleware separately, in which case it
 * converges within the TTL instead. The last known set is kept as the
 * read-failure fallback.
 */
export function invalidateFeatureRouteCache(): void {
  invalidateSettingsSnapshot()
}

/** Test hook: drop every cached state (snapshot, failure, resolved and last-known sets). */
export function _resetFeatureRoutesCache(): void {
  invalidateSettingsSnapshot()
  lastKnown = null
  resolved = null
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
