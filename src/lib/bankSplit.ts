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
  return Math.round(Number.parseFloat(amount) * 100)
}

export function isSplit(row: { splits?: SplitLine[] }): boolean {
  return Array.isArray(row.splits) && row.splits.length > 0
}

/**
 * Whether the split lines contain a duplicate giving row: the same member
 * twice under the same category. Giving statements aggregate by family, so a
 * family-only line also collides with a person line of that same family under
 * the same category (they would be one donor on a receipt). Two different
 * people of one family under one category stay allowed (e.g. a joint account
 * paying for two members), as does the same member under different
 * categories. Lines with no member (general fund) may repeat freely.
 * Shared by the client gate (`splitIsValid`) and the server check in
 * `bankImportConfirm`, so both always agree.
 */
export function hasDuplicateDonorSplit(
  splits: ReadonlyArray<{ accountId: number | null; familyId?: number | null; personId?: number | null }>
): boolean {
  const exact = new Set<string>()
  const byFamily = new Map<string, Set<number | null>>()
  for (const s of splits) {
    if (s.familyId == null && s.personId == null) continue
    const key = JSON.stringify([s.accountId, s.familyId, s.personId])
    if (exact.has(key)) return true
    exact.add(key)
    if (s.familyId == null) continue
    const famKey = JSON.stringify([s.accountId, s.familyId])
    const persons = byFamily.get(famKey) ?? new Set<number | null>()
    const person = s.personId ?? null
    // A family-only line collides with any person line of that family, and vice versa.
    if (person === null ? persons.size > 0 : persons.has(null)) return true
    persons.add(person)
    byFamily.set(famKey, persons)
  }
  return false
}

/** A split row is importable only when every line has a category, the lines
 * sum exactly to the row total, and no member is allocated twice under the
 * same category (see `hasDuplicateDonorSplit`).
 */
export function splitIsValid(row: { amount: string; splits?: SplitLine[] }): boolean {
  if (!row.splits || row.splits.length === 0) return false
  if (row.splits.some((s) => s.accountId === null || toCents(s.amount) <= 0)) return false
  const sum = row.splits.reduce((t, s) => t + toCents(s.amount), 0)
  if (hasDuplicateDonorSplit(row.splits)) return false
  return sum === toCents(row.amount)
}

/**
 * Status line shown under a split row: duplicate-donor warning, parse error,
 * allocation state, or the unallocated amount. `ok` is true only when fully allocated.
 */
export function splitStatus(
  splits: ReadonlyArray<{ accountId: number | null; familyId?: number | null; personId?: number | null }>,
  remainingCents: number
): { text: string; ok: boolean } {
  if (hasDuplicateDonorSplit(splits)) {
    return { text: "same member twice in one category — combine into one split", ok: false }
  }
  if (Number.isNaN(remainingCents)) return { text: "enter a valid amount for each split", ok: false }
  if (remainingCents === 0) return { text: "fully allocated", ok: true }
  return { text: `${(remainingCents / 100).toFixed(2)} unallocated`, ok: false }
}
