import { centsToNumber, fmtAUDAccounting } from "@/lib/formatting"
import { FY_START_MONTH } from "@/lib/appConfig"
import type { PLAccountRow } from "@/lib/reports/plQuery"

// Takes integer cents — every figure on the P&L is accumulated in cents
// and converted to dollars only here, at the moment of display.
export function fmt(cents: number): string {
  return fmtAUDAccounting(centsToNumber(cents))
}

export function accountTotal(a: PLAccountRow, totalMap: Map<number, number>): number {
  return totalMap.get(a.id) ?? 0
}

/** UTC `YYYY-MM-DD` for `Date.UTC(year, month, day)` — month/day may overflow. */
function isoDay(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)
}

/**
 * Drill-down link from a P&L figure to the transactions list, filtered to one
 * account over FY `year` — or, with `monthIndex` (0 = first FY month), over
 * that single month. `to` is the inclusive last day, matching the list's
 * `lte endOfDay` filter, so the rows sum to the P&L figure.
 */
export function plTransactionsHref(accountId: number, year: number, monthIndex?: number): string {
  const startMonth = FY_START_MONTH - 1 + (monthIndex ?? 0)
  const months = monthIndex === undefined ? 12 : 1
  const params = new URLSearchParams({
    account: String(accountId),
    from: isoDay(year, startMonth, 1),
    // Day 0 of the following month = last day of the range.
    to: isoDay(year, startMonth + months, 0),
  })
  return `/accounting/transactions?${params.toString()}`
}
