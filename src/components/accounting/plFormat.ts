import { APP_CURRENCY, APP_LOCALE } from "@/lib/appConfig"
import { centsToNumber, fmtAUDAccounting } from "@/lib/formatting"
import { fyDateRange } from "@/lib/fiscalYear"
import type { AccountGroup } from "@/lib/reports/accountGrouping"
import type { PLAccountRow } from "@/lib/reports/plQuery"

/**
 * Formats integer cents as an AUD accounting string. Every figure on the P&L
 * is accumulated in cents and converted to dollars only here, at display time.
 */
export function fmt(cents: number): string {
  return fmtAUDAccounting(centsToNumber(cents))
}

/**
 * Builds the compact cents formatter for the dense monthly grid. It formats as
 * an accounting currency figure, so fraction digits and the negative style
 * follow the locale and currency like `fmt` does (0 decimals for JPY, `-1.234,56`
 * for de-DE), then drops the currency symbol, since the table caption names the
 * currency once. Zero renders as an en dash so the real figures stand out.
 */
export function makeFmtGrid(locale: string, currency: string): (cents: number) => string {
  const nf = new Intl.NumberFormat(locale, { style: "currency", currency, currencySign: "accounting" })
  const scale = 10 ** (nf.resolvedOptions().maximumFractionDigits ?? 2)
  return (cents) => {
    const value = centsToNumber(cents)
    // Dash anything that rounds to zero at the currency's precision (e.g. 40
    // cents in JPY), not just an exact 0, so a "0" never shows in colour.
    if (Math.round(Math.abs(value) * scale) === 0) return "–"
    const parts = nf.formatToParts(value)
    const at = parts.findIndex((p) => p.type === "currency")
    return parts
      .map((p, i) => {
        if (i === at) return ""
        // Only the literals touching the symbol lose their spacing; signs and
        // brackets in them, and every other part, are kept.
        if (p.type === "literal" && Math.abs(i - at) === 1) return p.value.replace(/\s/g, "")
        return p.value
      })
      .join("")
  }
}

/** Grid formatter for the configured APP_LOCALE / APP_CURRENCY. */
export const fmtGrid = makeFmtGrid(APP_LOCALE, APP_CURRENCY)

/** Sign of a P&L figure, used to pick its colour in every layout. */
export type PLTone = "zero" | "positive" | "negative"

/** Classifies a cents figure as zero, positive or negative. */
export function plTone(cents: number): PLTone {
  if (cents === 0) return "zero"
  return cents > 0 ? "positive" : "negative"
}

/** Annual total (integer cents) for one account; 0 when it has no transactions. */
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
