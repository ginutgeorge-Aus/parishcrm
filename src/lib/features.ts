/**
 * Feature registry — the single list of toggleable features. Pure and
 * client-safe (no DB): the server reader lives in featureFlags.ts.
 */
export const FEATURES_SETTING_KEY = "features"
export const FEATURES_ONBOARDING_KEY = "features.onboarding"
/** Result a gated job/cron returns instead of running while its feature is off. */
export const FEATURE_OFF_SKIP = { skipped: "feature off" } as const
export type FeatureOffSkip = typeof FEATURE_OFF_SKIP
export const FEATURE_OFF_MESSAGE = "This feature is turned off. An admin can enable it in Settings → Features."
/** Off message for anonymous callers of public forms: never names admin settings. */
export const PUBLIC_FEATURE_OFF_MESSAGE = "This form is no longer available."

export type FeatureKey =
  | "celebrations" | "clearances" | "familyUpdates" | "memberships" | "welcomeLetter"
  | "sundaySchool" | "events" | "accounting"
  | "reconciliation" | "bankImport" | "pettyCash" | "dues" | "receipts" | "dgrReceipts" | "invoices" | "budget"

export type FeatureDef = {
  key: FeatureKey
  label: string
  description: string
  /** Child feature: off whenever the parent is off. */
  parent?: FeatureKey
  /** Other features that must be on for this one to be on. */
  requires?: FeatureKey[]
  /** Used when the DB holds no override for this key. */
  defaultOn: boolean
  /** Shown as a warning on the Features page when this feature has public links. */
  publicWarning?: string
}

export type FeatureOverrides = Partial<Record<FeatureKey, boolean>>

export const FEATURES: readonly FeatureDef[] = [
  { key: "celebrations", label: "Birthdays & anniversaries", description: "Celebration lists, dashboard tiles and greeting emails.", defaultOn: true },
  { key: "clearances", label: "Child-safety clearances", description: "Track Working With Children checks and expiry digests.", defaultOn: true },
  { key: "familyUpdates", label: "Family self-updates", description: "Families update their own details via a private link.", defaultOn: true, publicWarning: "Existing update links will stop working." },
  { key: "memberships", label: "Membership forms", description: "Public membership application form and review inbox.", defaultOn: true, publicWarning: "The public membership form will stop working." },
  { key: "welcomeLetter", label: "Welcome letters", description: "Generate welcome letters for new families.", defaultOn: true },
  { key: "sundaySchool", label: "Sunday School", description: "Classes, teachers and attendance.", defaultOn: true },
  { key: "events", label: "Events", description: "Events, registrations, check-in and online payments.", defaultOn: true, publicWarning: "Public event pages and registration links will stop working." },
  { key: "accounting", label: "Accounting", description: "Transactions, accounts, funds and financial reports.", defaultOn: true },
  { key: "reconciliation", parent: "accounting", label: "Bank reconciliation", description: "Match transactions to bank statements.", defaultOn: true },
  { key: "bankImport", parent: "accounting", label: "Bank import", description: "Import ANZ statement PDFs and OFX/QFX/QIF bank exports.", defaultOn: true },
  { key: "pettyCash", parent: "accounting", label: "Petty cash", description: "Petty cash sessions and counts.", defaultOn: true },
  { key: "dues", parent: "accounting", requires: ["memberships"], label: "Subscription dues", description: "Track member subscription dues.", defaultOn: true },
  { key: "receipts", parent: "accounting", label: "Giving receipts", description: "Email giving receipts and keep a send log.", defaultOn: true },
  { key: "dgrReceipts", parent: "accounting", label: "DGR receipts", description: "Tax-deductible (DGR) donation receipts.", defaultOn: true },
  { key: "invoices", parent: "accounting", label: "Invoices", description: "Invoices and customers.", defaultOn: true },
  { key: "budget", parent: "accounting", label: "Budget", description: "Annual budget and budget-vs-actual report.", defaultOn: true },
]

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURES.map((f) => f.key)
const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]))

/** Registry entry for `key`. */
export function featureDef(key: FeatureKey): FeatureDef {
  return BY_KEY.get(key)!
}

/**
 * Parse the stored overrides JSON. Anything malformed falls back to {} (registry
 * defaults) — a bad row must never lock an admin out of the app.
 */
export function parseOverrides(raw: string | null | undefined): FeatureOverrides {
  if (!raw) return {}
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {}
  const out: FeatureOverrides = {}
  for (const [k, v] of Object.entries(data)) {
    if (BY_KEY.has(k as FeatureKey) && typeof v === "boolean") out[k as FeatureKey] = v
  }
  return out
}

/**
 * `parseOverrides` for a stored row value, also reporting whether a non-empty
 * value yielded nothing usable (corrupt JSON). Pure: server callers log the
 * fallback to defaults via `parseOverridesWarn` (featuresWarn.ts).
 * @param raw stored `features` setting value
 */
export function parseStoredOverrides(raw: string | null | undefined): { overrides: FeatureOverrides; unreadable: boolean } {
  const overrides = parseOverrides(raw)
  // Whitespace-insensitive: a hand-formatted `{ }` is a valid empty value, not corrupt.
  const emptyObject = typeof raw === "string" && raw.replace(/\s/g, "") === "{}"
  return { overrides, unreadable: !!raw && Object.keys(overrides).length === 0 && !emptyObject }
}

/**
 * Resolve which features are on: own override ?? default, AND parent on, AND
 * every `requires` on.
 */
export function resolveFeatures(overrides: FeatureOverrides = {}): Set<FeatureKey> {
  const memo = new Map<FeatureKey, boolean>()
  const on = (key: FeatureKey): boolean => {
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    const def = featureDef(key)
    const v = (overrides[key] ?? def.defaultOn)
      && (!def.parent || on(def.parent))
      && (def.requires ?? []).every(on)
    memo.set(key, v)
    return v
  }
  return new Set(FEATURE_KEYS.filter(on))
}
