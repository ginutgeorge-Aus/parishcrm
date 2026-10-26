// src/lib/bankPossibleDuplicate.ts
import type { ParsedRow } from "@/lib/anzParser"
import { toCents } from "@/lib/formatting"

/**
 * Soft cross-format duplicate check: a parsed row whose date + amount + direction
 * equals an existing transaction (any source, incl. manual entry) but which was
 * NOT an exact/content-key duplicate. Catches the same bank line imported first
 * from a PDF and again from OFX/QIF, where descriptions/account formats differ.
 * Existing transactions consumed by exact duplicates are removed first. Each remaining one can vouch for at most one row, so two genuine
 * identical lines against one prior entry flag only one. Returns bankRefs.
 */
export function findPossibleDuplicates(
  rows: Pick<ParsedRow, "bankRef" | "date" | "amount" | "type">[],
  exactDuplicateRefs: Set<string>,
  existing: { date: Date; amount: { toString(): string }; type: string }[],
): string[] {
  const available = new Map<string, number>()
  for (const t of existing) {
    // Dates are stored at UTC midnight (date-only convention), so the ISO date part is the wall-clock date.
    const k = `${t.date.toISOString().slice(0, 10)}|${toCents(t.amount.toString())}|${t.type}`
    available.set(k, (available.get(k) ?? 0) + 1)
  }
  const keyOf = (r: Pick<ParsedRow, "date" | "amount" | "type">) => `${r.date}|${toCents(r.amount)}|${r.type}`
  // Existing rows matched by exact duplicates are already spoken for.
  for (const r of rows) {
    if (!exactDuplicateRefs.has(r.bankRef)) continue
    const k = keyOf(r)
    const n = available.get(k) ?? 0
    if (n > 0) available.set(k, n - 1)
  }
  const flagged: string[] = []
  for (const r of rows) {
    if (exactDuplicateRefs.has(r.bankRef)) continue
    const k = keyOf(r)
    const n = available.get(k) ?? 0
    if (n > 0) {
      available.set(k, n - 1)
      flagged.push(r.bankRef)
    }
  }
  return flagged
}
