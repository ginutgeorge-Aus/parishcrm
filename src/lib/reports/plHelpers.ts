import { FY_START_MONTH } from "@/lib/appConfig"
import { MONTH_ABBR, type Money, toCents } from "@/lib/formatting"

/**
 * FY month order as 0-based calendar months, starting at FY_START_MONTH
 * (default July: index 0 = Jul (getMonth()=6), index 11 = Jun (5)). Must
 * match plTransactionsHref, which maps a column index back to a date range.
 */
export const FY_MONTHS: readonly number[] = Array.from(
  { length: 12 },
  (_, i) => (FY_START_MONTH - 1 + i) % 12,
)

export const MONTH_LABELS: readonly string[] = FY_MONTHS.map((m) => MONTH_ABBR[m])


export type MonthlyTx = {
  amount: { toString(): string }
  date: Date
}

/**
 * FY month index (0 = first FY month … 11 = last), or -1 if out of range.
 * getUTCMonth() — transaction dates are stored as UTC-midnight calendar anchors
 * (see lib/dates.ts); getMonth() reads them in the server's local zone and
 * buckets boundary dates into the wrong FY month on a non-UTC server.
 */
function fyMonthIndex(date: Date): number {
  return FY_MONTHS.indexOf(date.getUTCMonth())
}

/**
 * Cent-safe account balance: opening + income - expense. All arithmetic
 * runs in integer cents so summing many Decimals never accumulates IEEE-754
 * drift; a single final divide converts back to dollars for display.
 */
export function accountBalance(opening: Money, income: Money, expense: Money): number {
  return (toCents(opening) + toCents(income) - toCents(expense)) / 100
}

/**
 * Returns an array of 12 integer-CENT totals — one per FY month (index 0 = first FY month,
 * 11 = last). Cents, not dollars, so a caller can keep summing across accounts
 * without IEEE-754 drift; convert with `centsToNumber` only at display.
 * Caller must pre-filter transactions to the target FY — month index is
 * determined solely by getUTCMonth(), not by year.
 */
export function monthlyAmounts(transactions: MonthlyTx[]): number[] {
  const result = new Array<number>(12).fill(0)
  for (const t of transactions) {
    const idx = fyMonthIndex(t.date)
    if (idx >= 0) result[idx] += toCents(t.amount)
  }
  return result
}

/**
 * Sums monthly amounts (integer cents) across multiple accounts' transaction
 * arrays. Each element of `groups` is one account's MonthlyTx[].
 */
export function monthlySum(groups: MonthlyTx[][]): number[] {
  const result = new Array<number>(12).fill(0)
  for (const txs of groups) {
    const amounts = monthlyAmounts(txs)
    for (let i = 0; i < 12; i++) result[i] += amounts[i]
  }
  return result
}

/**
 * Folds a batch of transactions (each tagged with an accountId) into an
 * existing accountId -> 12-element integer-cent map, using the SAME FY
 * month-index logic as monthlyAmounts (index 0 = first FY month). Caller must pre-filter
 * to the FY. Accumulates in place so a caller can stream many batches into one
 * map without materialising every row at once. With `counts`, also tallies
 * transactions per account-month — a month can net to 0 yet still have rows.
 */
export function accumulateMonthlyByAccount(
  map: Map<number, number[]>,
  transactions: (MonthlyTx & { accountId: number })[],
  counts?: Map<number, number[]>,
): void {
  for (const t of transactions) {
    const idx = fyMonthIndex(t.date)
    if (idx < 0) continue
    let arr = map.get(t.accountId)
    if (!arr) {
      arr = new Array<number>(12).fill(0)
      map.set(t.accountId, arr)
    }
    arr[idx] += toCents(t.amount)
    if (counts) {
      let c = counts.get(t.accountId)
      if (!c) {
        c = new Array<number>(12).fill(0)
        counts.set(t.accountId, c)
      }
      c[idx]++
    }
  }
}

/**
 * Buckets a flat list of transactions (each tagged with an accountId) into a
 * Map of accountId -> 12-element integer-cent array, using the SAME FY
 * month-index logic as monthlyAmounts (index 0 = first FY month). Caller must pre-filter
 * to the FY.
 */
export function monthlyAmountsByAccount(
  transactions: (MonthlyTx & { accountId: number })[],
): Map<number, number[]> {
  const map = new Map<number, number[]>()
  accumulateMonthlyByAccount(map, transactions)
  return map
}
