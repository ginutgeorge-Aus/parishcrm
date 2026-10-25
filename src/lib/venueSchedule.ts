// Pure scheduling helpers for the monthly venue invoice-request job.
// No DB / server-only imports: safe for client components and unit tests.

import { sydneyClock } from "@/lib/dates"
import { addMonths, formatMonthLabel, previousMonth } from "@/lib/venueUsage"

/** The scheduled invoice job opens at this Sydney hour on the 1st. */
export const VENUE_JOB_FROM_HOUR = 9
/** Last Sydney day-of-month the job may act on (spec: only the 1st). Raise to add outage catch-up. */
export const VENUE_JOB_LAST_DAY = 1

/**
 * True when the monthly venue job may act: the Sydney date is within the job window
 * (the 1st) and the Sydney hour is at least 09:00.
 * @param now current instant
 */
export function venueJobWindowOpen(now: Date): boolean {
  const c = sydneyClock(now)
  const day = Number(c.ymd.slice(8, 10))
  return day <= VENUE_JOB_LAST_DAY && c.hour >= VENUE_JOB_FROM_HOUR
}

/**
 * The month the job invoices when it runs at `now`: the month before the Sydney month of `now`.
 * @param now current instant
 */
export function venueInvoiceMonth(now: Date): string {
  return previousMonth(sydneyClock(now).ymd)
}

/**
 * Admin-facing label of when an approved month is sent, e.g. "1 November, 9:00 AM" for "2026-10".
 * The "9:00 AM" text matches {@link VENUE_JOB_FROM_HOUR}; change both together.
 * @param month the month being approved, "YYYY-MM"
 */
export function autoSendLabel(month: string): string {
  const monthName = formatMonthLabel(addMonths(month, 1)).split(" ")[0]
  return `1 ${monthName}, 9:00 AM`
}
