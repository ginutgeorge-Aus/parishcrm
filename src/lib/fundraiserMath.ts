import { toCents, type Money } from "@/lib/formatting"

/**
 * Ceiling on what one entry may owe (quantity x unit price), in cents: AUD
 * 999,999.99. Below Stripe's per-charge maximum for AUD and far below the
 * Decimal(10,2) column limit, so a typo can never 500 on write or on checkout.
 */
export const MAX_OWED_CENTS = 99_999_999

/** Payment state of one fundraiser entry. */
type FundraiserStatus = "UNPAID" | "PART" | "PAID" | "OVERPAID"

/** Per-entry totals in integer cents. */
export type EntryTotals = {
  owedCents: number
  paidCents: number
  remainingCents: number
  status: FundraiserStatus
}

/**
 * Compute what an entry owes, has paid and still owes, in integer cents.
 * `remainingCents` is never negative; paid > owed gives status OVERPAID.
 * @param e entry with quantity and unit price
 * @param payments payments recorded against the entry
 */
export function entryTotals(
  e: { quantity: number; unitPrice: Money },
  payments: { amount: Money }[],
): EntryTotals {
  const owedCents = e.quantity * toCents(e.unitPrice)
  let paidCents = 0
  for (const p of payments) paidCents += toCents(p.amount)
  const remainingCents = Math.max(0, owedCents - paidCents)
  let status: FundraiserStatus
  if (paidCents > owedCents) status = "OVERPAID"
  else if (paidCents === owedCents && owedCents > 0) status = "PAID"
  else if (paidCents > 0) status = "PART"
  else status = "UNPAID"
  return { owedCents, paidCents, remainingCents, status }
}

/**
 * Roll entry totals up to fundraiser level. OVERPAID rows contribute their full
 * paid amount to collected and 0 to outstanding.
 * @param rows results of `entryTotals`
 */
export function fundraiserTotals(rows: EntryTotals[]): {
  expectedCents: number
  collectedCents: number
  outstandingCents: number
} {
  let expectedCents = 0
  let collectedCents = 0
  let outstandingCents = 0
  for (const r of rows) {
    expectedCents += r.owedCents
    collectedCents += r.paidCents
    outstandingCents += r.remainingCents
  }
  return { expectedCents, collectedCents, outstandingCents }
}
