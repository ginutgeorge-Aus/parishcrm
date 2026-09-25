import { sydneyStartOfDayUTC, sydneyEndOfDayUTC } from "@/lib/dates"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * True for a `YYYY-MM-DD` string that is both digit-shaped and a real
 * calendar date. The regex alone lets through shapes like "2026-02-30" —
 * `new Date(...)` doesn't reject those, it silently rolls them over to the
 * next valid date (Mar 2), so a shape-only check can quietly filter on a
 * different day than the caller typed.
 */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const utcDate = new Date(value + "T00:00:00.000Z")
  return !Number.isNaN(utcDate.getTime()) && utcDate.toISOString().slice(0, 10) === value
}

/**
 * Build the Prisma `createdAt` range filter for the audit log from optional
 * `from`/`to` `YYYY-MM-DD` query params.
 *
 * `createdAt` is a real instant (`now()`), not a date-only value — anchor the
 * bounds to the Sydney calendar day so AEST/AEDT filtering is correct.
 * Non-ISO, calendar-invalid, or missing inputs are ignored. Returns
 * `undefined` when neither bound is set, so callers can omit the `createdAt`
 * key entirely.
 */
export function buildCreatedAtFilter(
  from?: string,
  to?: string
): { gte?: Date; lte?: Date } | undefined {
  const createdAtFilter: { gte?: Date; lte?: Date } = {}
  if (from !== undefined && isValidIsoDate(from)) {
    createdAtFilter.gte = sydneyStartOfDayUTC(from)
  }
  if (to !== undefined && isValidIsoDate(to)) {
    createdAtFilter.lte = sydneyEndOfDayUTC(to)
  }
  return Object.keys(createdAtFilter).length > 0 ? createdAtFilter : undefined
}
