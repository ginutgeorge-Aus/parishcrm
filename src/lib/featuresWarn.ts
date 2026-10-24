import { parseStoredOverrides, type FeatureOverrides } from "@/lib/features"

// Last stored value already warned about: an unreadable value logs once, not on every read or refresh.
let warned: string | null = null

/**
 * Parse a stored `features` value for a server caller, warning (once per
 * distinct value, shared by every reader) when it is unreadable and defaults apply.
 * Kept out of features.ts, which stays pure and client-safe.
 * @param raw stored `features` setting value
 */
export function parseOverridesWarn(raw: string | null | undefined): FeatureOverrides {
  const { overrides, unreadable } = parseStoredOverrides(raw)
  if (unreadable && warned !== raw) {
    warned = raw ?? null
    console.warn("[features] unreadable 'features' setting — using defaults")
  } else if (!unreadable) {
    warned = null
  }
  return overrides
}

/** Test hook: forget the last warned value. */
export function _resetFeaturesWarn(): void {
  warned = null
}
