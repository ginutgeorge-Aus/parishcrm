/**
 * Fiscal year helpers. The FY start month is configurable via
 * APP_FY_START_MONTH (default 7 = July, reproducing the Australian
 * July–June FY). The FY is named by its starting calendar year, e.g. with a
 * July start FY 2025 = 1 Jul 2025 → 30 Jun 2026.
 */

import { sydneyParts } from "@/lib/dates"
import { FY_START_MONTH } from "@/lib/appConfig"

/**
 * The FY year that the given instant falls in, evaluated against the Sydney
 * wall clock — not the server's UTC clock, which would flip the FY ~10h
 * late every FY boundary. Months from FY_START_MONTH onward belong to the
 * current calendar year's FY; earlier months belong to the prior year.
 */
export function currentFYYear(date: Date = new Date()): number {
  const { year, month } = sydneyParts(date)
  return month >= FY_START_MONTH ? year : year - 1
}

/**
 * Half-open date range for an FY: `{ start: <year>-<FY_START_MONTH>-01,
 * end: <year+1>-<FY_START_MONTH>-01 }`. Use as `{ gte: start, lt: end }` —
 * end is exclusive.
 */
export function fyDateRange(year: number): { start: Date; end: Date } {
  // Explicit UTC construction (not bare `new Date('YYYY-MM-01')`) so the FY
  // boundaries anchor at UTC midnight regardless of server timezone.
  return {
    start: new Date(Date.UTC(year, FY_START_MONTH - 1, 1)),
    end: new Date(Date.UTC(year + 1, FY_START_MONTH - 1, 1)),
  }
}

/**
 * Parse a `?year=` FY param. Absent → current FY. Digits only, within
 * 2000..fyNow+10; anything else → null so the caller picks 400 vs fallback.
 */
export function parseFyYearParam(raw: string | null | undefined, fyNow: number = currentFYYear()): number | null {
  if (raw == null) return fyNow
  if (!/^\d+$/.test(raw)) return null
  const year = Number(raw)
  return year >= 2000 && year <= fyNow + 10 ? year : null
}
