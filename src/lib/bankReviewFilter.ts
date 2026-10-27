import type { ReviewRow } from "@/lib/bankTypes"
import { isSplit, splitIsValid } from "@/lib/bankSplit"
import { toCents } from "@/lib/formatting"

export type ReviewFilter = "all" | "needsCategory" | "matched" | "duplicates" | "skipped"

export type ReviewStats = {
  total: number
  needsCategory: number
  matched: number
  duplicates: number
  skipped: number
  incomeCents: number
  expenseCents: number
}

/**
 * An active row that would block import: mirrors BankReviewTable's canImport
 * rule (ambiguous type, or no category / invalid split, unless it's a
 * petty-cash transfer).
 */
export function needsCategory(row: ReviewRow): boolean {
  if (row.skip) return false
  if (row.ambiguousType) return true
  if (row.fromPettyCash) return false
  return isSplit(row) ? !splitIsValid(row) : row.accountId === null
}

/** View-only tab predicate; never changes row state. */
export function matchesFilter(row: ReviewRow, filter: ReviewFilter): boolean {
  switch (filter) {
    case "all": return true
    case "needsCategory": return needsCategory(row)
    case "matched": return row.personId !== null
    case "duplicates": return row.isDuplicate || row.isPossibleDuplicate === true
    case "skipped": return row.skip
  }
}

/** Tab counts plus income/expense totals of the rows that will be imported (integer cents). */
export function reviewStats(rows: ReviewRow[]): ReviewStats {
  const s: ReviewStats = { total: rows.length, needsCategory: 0, matched: 0, duplicates: 0, skipped: 0, incomeCents: 0, expenseCents: 0 }
  for (const row of rows) {
    if (needsCategory(row)) s.needsCategory++
    if (matchesFilter(row, "matched")) s.matched++
    if (matchesFilter(row, "duplicates")) s.duplicates++
    if (row.skip) s.skipped++
    else if (row.type === "INCOME") s.incomeCents += toCents(row.amount)
    else s.expenseCents += toCents(row.amount)
  }
  return s
}

/**
 * Bulk skip/unskip limited to `indices`. Unskipping never touches exact or
 * possible duplicates: those stay skipped until the user opts in per row.
 */
export function applyBulkSkip(rows: ReviewRow[], skip: boolean, indices: readonly number[]): ReviewRow[] {
  const target = new Set(indices)
  return rows.map((r, i) => {
    if (!target.has(i)) return r
    if (!skip && (r.isDuplicate || r.isPossibleDuplicate === true)) return r
    return { ...r, skip }
  })
}
