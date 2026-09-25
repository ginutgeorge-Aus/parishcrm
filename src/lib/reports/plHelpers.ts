/**
 * FY month order: July–June.
 * Index 0 = Jul (getMonth()=6), index 11 = Jun (getMonth()=5).
 */
export const FY_MONTHS = [6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5] as const

export const MONTH_LABELS = [
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
] as const

import { type Money, toCents } from "@/lib/formatting"

export type MonthlyTx = {
  amount: { toString(): string }
  date: Date
}

/**
 * FY month index (0 = Jul … 11 = Jun), or -1 if out of range.
 * getUTCMonth() — transaction dates are stored as UTC-midnight calendar anchors
 * (see lib/dates.ts); getMonth() reads them in the server's local zone and
 * buckets boundary dates into the wrong FY month on a non-UTC server.
 */
function fyMonthIndex(date: Date): number {
  return FY_MONTHS.indexOf(date.getUTCMonth() as (typeof FY_MONTHS)[number])
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
 * Returns an array of 12 integer-CENT totals — one per FY month (index 0 = Jul,
 * 11 = Jun). Cents, not dollars, so a caller can keep summing across accounts
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
 * month-index logic as monthlyAmounts (index 0 = Jul). Caller must pre-filter
 * to the FY. Accumulates in place so a caller can stream many batches into one
 * map without materialising every row at once.
 */
export function accumulateMonthlyByAccount(
  map: Map<number, number[]>,
  transactions: (MonthlyTx & { accountId: number })[],
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
  }
}

/**
 * Buckets a flat list of transactions (each tagged with an accountId) into a
 * Map of accountId -> 12-element integer-cent array, using the SAME FY
 * month-index logic as monthlyAmounts (index 0 = Jul). Caller must pre-filter
 * to the FY.
 */
export function monthlyAmountsByAccount(
  transactions: (MonthlyTx & { accountId: number })[],
): Map<number, number[]> {
  const map = new Map<number, number[]>()
  accumulateMonthlyByAccount(map, transactions)
  return map
}
