import { toCents, centsToNumber } from "@/lib/formatting"
import { endOfDayUTC } from "@/lib/dates"

export type StatusFilter = "all" | "pending" | "reconciled"

// Status filter applies to the transaction LIST only — the summary bar and
// equation stay full-period so their totals never depend on the view.
export function resolveStatusFilter(status: string | undefined): StatusFilter {
  if (status === "pending" || status === "reconciled") return status
  return "all"
}

export function statusWhereClause(filter: StatusFilter): { reconciled?: boolean } {
  if (filter === "pending") return { reconciled: false }
  if (filter === "reconciled") return { reconciled: true }
  return {}
}

export function isBeforeOpeningBalance(
  openingBalance: { asOfDate: Date } | null,
  toDate: Date
): boolean {
  return !!openingBalance && endOfDayUTC(toDate) < openingBalance.asOfDate
}

// There's a usable book-balance anchor for this period when there's an
// opening balance AND the window's end isn't before it.
export function hasPeriodAnchor(
  openingBalance: { asOfDate: Date } | null,
  beforeOpeningBalance: boolean
): boolean {
  return !!openingBalance && !beforeOpeningBalance
}

type Money = number | { toString(): string }

// Book balance counts ALL transactions in the period (not just reconciled):
// saving a closing balance that matches this book balance is what marks the
// period reconciled (reconcile-on-save).
export function computeBookBalance(
  openingBalance: { amount: Money } | null,
  anchor: boolean,
  incomeAmount: Money,
  expenseAmount: Money
): number | null {
  if (!openingBalance || !anchor) return null
  return centsToNumber(toCents(openingBalance.amount) + toCents(incomeAmount) - toCents(expenseAmount))
}

// Running book balance down the list. Only meaningful when there is an
// opening-balance anchor, the view isn't status-filtered (a running balance
// that skips rows means nothing), and the window starts on or after the
// anchor (else pre-anchor rows would double-count against the opening
// balance).
export function shouldShowRunningBalance(
  openingBalance: { asOfDate: Date } | null,
  statusFilter: StatusFilter,
  fromDate: Date
): boolean {
  return !!openingBalance && statusFilter === "all" && fromDate >= openingBalance.asOfDate
}
