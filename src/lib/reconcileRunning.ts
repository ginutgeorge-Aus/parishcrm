import type { TransactionType } from "@/lib/generated/prisma/enums"

/**
 * Running book balance down a date-ascending transaction list.
 *
 * Given the account balance at the point just before the first row (`startCents`)
 * and each row's signed effect (INCOME adds, EXPENSE subtracts), return the
 * balance in integer cents AFTER each row. Cent math throughout — the caller
 * converts Decimal(10,2) amounts with toCents so there is no IEEE-754 drift.
 *
 * Pure: does not mutate its input.
 */
export function computeRunningBalances(
  rows: { type: TransactionType; amountCents: number }[],
  startCents: number,
): number[] {
  let running = startCents
  return rows.map((r) => {
    running += r.type === "INCOME" ? r.amountCents : -r.amountCents
    return running
  })
}
