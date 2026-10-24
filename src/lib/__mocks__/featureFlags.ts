// Shared manual mock for `jest.mock("@/lib/featureFlags")`: every feature on.
// Suites that test feature-off behaviour override a function per test, e.g.
// `(featureGuard as jest.Mock).mockResolvedValueOnce({ error: "…" })`.
export const getEnabledFeatures = jest.fn(async () => (await import("@/lib/features")).resolveFeatures({}))
export const isFeatureOn = jest.fn().mockResolvedValue(true)
export const requireFeature = jest.fn().mockResolvedValue(undefined)
export const featureGuard = jest.fn().mockResolvedValue(null)
export const featureGuardAny = jest.fn().mockResolvedValue(null)
export const assertFeature = jest.fn().mockResolvedValue(undefined)
export const featureNotFound = jest.fn().mockResolvedValue(null)
export const cronFeatureSkip = jest.fn().mockResolvedValue(null)
export const skipIfFeatureOff = jest.fn((_key: unknown, fn: () => Promise<unknown>) => fn())
export const readRawOverrides = jest.fn().mockResolvedValue({})
export const getStoredOverrides = jest.fn().mockResolvedValue({})
