/**
 * Budget-variance threshold flagging. The budget-vs-actual report
 * already colors variances green/red by favorability (`varianceColor` in the
 * page). This adds a magnitude-based flag — any line whose variance is a big
 * enough swing from budget, in EITHER direction, gets a visible "over
 * threshold" marker regardless of whether that swing is favorable.
 */

export const DEFAULT_VARIANCE_THRESHOLD_PCT = 10

/**
 * True when |variance| as a percentage of budget strictly exceeds
 * `thresholdPct`. A zero (or missing, represented as 0 by the caller) budget
 * never flags — the percentage is undefined, not infinite.
 */
export function isOverVarianceThreshold(
  variance: number,
  budget: number,
  thresholdPct: number = DEFAULT_VARIANCE_THRESHOLD_PCT,
): boolean {
  if (budget === 0) return false
  const pct = Math.abs((variance / budget) * 100)
  return pct > thresholdPct
}

/**
 * Parses the `?threshold=` query param into a positive percentage, falling
 * back to `DEFAULT_VARIANCE_THRESHOLD_PCT` when missing, non-numeric, zero,
 * or negative.
 */
export function parseVarianceThreshold(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_VARIANCE_THRESHOLD_PCT
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_VARIANCE_THRESHOLD_PCT
  return parsed
}
