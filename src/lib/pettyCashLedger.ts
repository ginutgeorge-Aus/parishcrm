import { type Money, toCents, sumCents, centsToNumber } from "@/lib/formatting"

/**
 * Cash-in-hand = opening + receipts − expenses − transfers, summed in integer
 * cents so a long session of Decimal amounts never drifts; the single
 * final divide returns dollars. Accepts Prisma Decimals directly — callers no
 * longer need to `Number(...)` each amount.
 */
export function calcRunningBalance(
  openingBalance: Money,
  receipts: { amount: Money }[],
  expenses: { amount: Money }[],
  transfers: { amount: Money }[]
): number {
  const cents =
    toCents(openingBalance) +
    sumCents(receipts.map((r) => r.amount)) -
    sumCents(expenses.map((e) => e.amount)) -
    sumCents(transfers.map((t) => t.amount))
  return centsToNumber(cents)
}

/** Human label for a closing variance (dollars). Positive = over, negative = short. */
export function varianceLabel(variance: number): string {
  if (variance === 0) return "Balanced"
  return `${Math.abs(variance).toFixed(2)} ${variance > 0 ? "over" : "short"}`
}
