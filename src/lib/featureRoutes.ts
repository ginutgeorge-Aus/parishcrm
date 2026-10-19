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
 * Features a page path depends on (empty when ungated).
 * @param pathname request pathname (trailing slash tolerated)
 */
export function featuresForPath(pathname: string): FeatureKey[] {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
  return FEATURE_ROUTES.filter((r) => r.match.test(path)).map((r) => r.feature)
}

/** Path the middleware rewrites a blocked request to: no such route, so the app 404 renders. */
export const FEATURE_OFF_REWRITE_PATH = "/_feature-off"

const TTL_MS = 5_000
let cache: { on: Set<FeatureKey>; at: number } | null = null

/**
 * Enabled features for the middleware, cached 5s per process (every request
 * passes through it). Returns null on a read failure (fail open): a DB blip
 * must not 404 the whole app — layouts and actions still enforce per request.
 */
export async function getEnabledFeaturesCached(): Promise<Set<FeatureKey> | null> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.on
  try {
    const { prisma } = await import("@/lib/prisma")
    const row = await prisma.appSetting.findUnique({ where: { key: FEATURES_SETTING_KEY } })
    const on = resolveFeatures(parseOverrides(row?.value))
    cache = { on, at: now }
    return on
  } catch {
    return null
  }
}

/** Test hook: drop the cached feature set. */
export function _resetFeatureRoutesCache(): void {
  cache = null
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
