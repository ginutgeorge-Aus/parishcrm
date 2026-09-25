export const IDLE_TIMEOUT_OPTIONS_LIST = [15, 30, 60, 120] as const

// Fallback church name used everywhere a churchName setting/env var is unset —
// keep this as the one place that copy-pastes across ~15 email/print/settings
// call sites used to drift from.
export const DEFAULT_CHURCH_NAME = "Your Church"
// The software product name (not the church) — used where the app itself is named.
export const PRODUCT_NAME = "ParishCRM"
