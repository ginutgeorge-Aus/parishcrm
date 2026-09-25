// Pure helpers for bank import split rows. Extracted from BankReviewTable.tsx
// so non-UI modules (server components, API routes, tests) can import them
// without pulling in the React component tree.

/** One category allocation of a split bank line. amount is the same string
 * form as ParsedRow.amount (e.g. "60.00"). A row with a non-empty `splits`
 * array is imported as one Transaction per line instead of one for the whole
 * row.
 */
export type SplitLine = {
  accountId: number | null
  familyId: number | null
  personId: number | null
  amount: string
  // Client-only stable React key so a line's row (and its member-combobox
  // popover state) travels with the data, not with its array index, when an
  // earlier line is removed. Optional; ignored server-side (the confirm
  // zod schema strips unknown keys).
  _key?: string
}

/** Integer cents from an amount string — avoids float drift when summing splits. */
export function toCents(amount: string): number {
  return Math.round(parseFloat(amount) * 100)
}

export function isSplit(row: { splits?: SplitLine[] }): boolean {
  return Array.isArray(row.splits) && row.splits.length > 0
}

/** A split row is importable only when every line has a category and the lines
 * sum exactly to the row total.
 */
export function splitIsValid(row: { amount: string; splits?: SplitLine[] }): boolean {
  if (!row.splits || row.splits.length === 0) return false
  if (row.splits.some((s) => s.accountId === null || toCents(s.amount) <= 0)) return false
  const sum = row.splits.reduce((t, s) => t + toCents(s.amount), 0)
  return sum === toCents(row.amount)
}
