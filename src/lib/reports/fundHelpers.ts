import { toCents } from "@/lib/formatting"

export type FundAggRow = { fundId: number | null; type: "INCOME" | "EXPENSE"; amount: { toString(): string } | string }
export type FundRow = { fundId: number | null; name: string; incomeCents: number; expenseCents: number; netCents: number }

/**
 * Aggregates transaction rows into one FundRow per fund (integer cents).
 * `fundId === null` collapses into a single "General (unassigned)" bucket —
 * transactions/petty-cash entries recorded without a fund. Caller pre-filters
 * rows to the target FY.
 */
export function aggregateByFund(rows: FundAggRow[], fundNames: Map<number, string>): FundRow[] {
  const acc = new Map<number | null, { income: number; expense: number }>()
  for (const r of rows) {
    const key = r.fundId
    let a = acc.get(key)
    if (!a) {
      a = { income: 0, expense: 0 }
      acc.set(key, a)
    }
    if (r.type === "INCOME") a.income += toCents(r.amount)
    else a.expense += toCents(r.amount)
  }
  const out: FundRow[] = []
  for (const [fundId, a] of acc) {
    out.push({
      fundId,
      name: fundId === null ? "General (unassigned)" : (fundNames.get(fundId) ?? `Fund #${fundId}`),
      incomeCents: a.income,
      expenseCents: a.expense,
      netCents: a.income - a.expense,
    })
  }
  // Named funds first (by name), General bucket last. Equal-key branch first so
  // the comparator stays reflexive (cmp(a,a)===0) / a valid strict weak ordering
  // — the aggregation yields at most one null bucket, but keep it sound.
  return out.sort((x, y) => {
    if (x.fundId === y.fundId) return 0
    if (x.fundId === null) return 1
    if (y.fundId === null) return -1
    return x.name.localeCompare(y.name)
  })
}
