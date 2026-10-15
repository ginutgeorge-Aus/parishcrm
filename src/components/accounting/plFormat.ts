import { APP_LOCALE } from "@/lib/appConfig"
import { centsToNumber, fmtAUDAccounting } from "@/lib/formatting"
import { fyDateRange } from "@/lib/fiscalYear"
import type { AccountGroup } from "@/lib/reports/accountGrouping"
import type { PLAccountRow } from "@/lib/reports/plQuery"

// Takes integer cents — every figure on the P&L is accumulated in cents
// and converted to dollars only here, at the moment of display.
export function fmt(cents: number): string {
  return fmtAUDAccounting(centsToNumber(cents))
}

const gridNumber = new Intl.NumberFormat(APP_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Compact cents formatter for the dense monthly grid: no currency symbol
 * (the table caption names the currency once), accounting parentheses for negatives, and an
 * en dash for zero so the real figures stand out.
 */
export function fmtGrid(cents: number): string {
  if (cents === 0) return "–"
  const formattedGridValue = gridNumber.format(Math.abs(centsToNumber(cents)))
  return cents < 0 ? `(${formattedGridValue})` : formattedGridValue
}

/**
 * Calculates the total amount for a given account row based on a map of totals.
 *
 * @param a The account row containing the account ID.
 * @param totalMap A map where the key is the account ID and the value is the total amount.
 * @returns The total amount for the given account ID, or 0 if not found.
 */
export function accountTotal(a: PLAccountRow, totalMap: Map<number, number>): number {
  return totalMap.get(a.id) ?? 0
}
}

/**
 * Drill-down link from a P&L figure to the transactions list, filtered to one
 * account over FY `year` — or, with `monthIndex` (0 = first FY month), over
 * that single month. `to` is the inclusive last day, matching the list's
 * `lte endOfDay` filter, so the rows sum to the P&L figure.
 */
export function plTransactionsHref(accountId: number, year: number, monthIndex?: number): string {
  if (monthIndex !== undefined && !(Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex < 12)) {
    throw new RangeError(`monthIndex must be an integer 0–11, got ${monthIndex}`)
  }
  // Anchor on fyDateRange — the same range plQuery buckets — so link dates
  // can't drift from the columns.
  const { start } = fyDateRange(year)
  const startYear = start.getUTCFullYear()
  const startMonth = start.getUTCMonth() + (monthIndex ?? 0)
  const months = monthIndex === undefined ? 12 : 1
  const params = new URLSearchParams({
    account: String(accountId),
    from: isoDay(startYear, startMonth, 1),
    // Day 0 of the following month = last day of the range.
    to: isoDay(startYear, startMonth + months, 0),
  })
  return `/accounting/transactions?${params.toString()}`
}

type PLSectionInput = {
  incomeGroups: AccountGroup<PLAccountRow>[]
  expenseGroups: AccountGroup<PLAccountRow>[]
  totalIncome: number
  totalExpenses: number
  /** Per-section 12-month cents — monthly view only. */
  incomeMonthly?: number[]
  expenseMonthly?: number[]
}

/** Income then Expenses, in render order — shared by every P&L layout. */
export function plSections({
  incomeGroups,
  expenseGroups,
  totalIncome,
  totalExpenses,
  incomeMonthly = [],
  expenseMonthly = [],
}: PLSectionInput) {
  return [
    { key: "ig", label: "Income", groups: incomeGroups, total: totalIncome, monthly: incomeMonthly },
    { key: "eg", label: "Expenses", groups: expenseGroups, total: totalExpenses, monthly: expenseMonthly },
  ] as const
}
