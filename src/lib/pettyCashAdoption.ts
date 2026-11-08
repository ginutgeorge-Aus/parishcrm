import { toCents } from "@/lib/formatting"
import { utcYmd } from "@/lib/dates"
import { depositRefOfLeg } from "@/lib/xferRefs"

/** Why an imported deposit + its XFER_OUT leg cannot back a petty cash transfer. */
export type AdoptionProblem = "unavailable" | "reconciled" | "legMismatch" | "depositMismatch" | "legDate"

/** User-facing error for each {@link AdoptionProblem}. */
export const ADOPTION_ERRORS: Record<AdoptionProblem, string> = {
  unavailable: "Imported deposit is not available for transfer",
  reconciled: "Imported deposit's cash-out is already reconciled",
  legMismatch: "Imported deposit's cash-out entry does not match this transfer",
  depositMismatch: "Date and amount must match the imported deposit",
  legDate: "Imported deposit's cash-out date does not match this transfer",
}

type Money = { toFixed(n: number): string }

/**
 * Single source of truth for whether an imported deposit and its paired XFER_OUT
 * leg can back a petty cash transfer, or null when they can. Checks the deposit
 * (XFER account, INCOME), the leg (exists, unlinked, unreconciled, EXPENSE on the
 * XFER account and the cash payment account) and that deposit and leg both agree
 * with `transfer` on amount and UTC calendar day. Used by createTransfer (transfer
 * = the entered values) and the candidate loader (transfer = the deposit's own
 * values) so the picker never offers a pair createTransfer would reject.
 */
export function adoptionProblem(
  deposit: { accountId: number; type: string; amount: Money; date: Date } | null,
  leg: {
    type: string; accountId: number; reconciled: boolean; paymentAccountId: number | null
    pettyCashTransferId: number | null; amount: Money; date: Date
  } | null,
  transfer: { amount: string; date: Date },
  ctx: { xferAccountId: number | null; cashAccountId: number | null },
): AdoptionProblem | null {
  if (!deposit || deposit.accountId !== ctx.xferAccountId || deposit.type !== "INCOME" || !leg || leg.pettyCashTransferId !== null)
    return "unavailable"
  if (leg.reconciled) return "reconciled"
  if (
    leg.type !== "EXPENSE" || leg.accountId !== ctx.xferAccountId || (leg.paymentAccountId !== null && leg.paymentAccountId !== ctx.cashAccountId) ||
    toCents(leg.amount.toFixed(2)) !== toCents(transfer.amount)
  )
    return "legMismatch"
  if (toCents(deposit.amount.toFixed(2)) !== toCents(transfer.amount) || utcYmd(deposit.date) !== utcYmd(transfer.date))
    return "depositMismatch"
  if (utcYmd(leg.date) !== utcYmd(transfer.date)) return "legDate"
  return null
}

/** Per-deposit summary of the cash-out leg the manual guard found in the window (`day` = the leg's UTC YYYY-MM-DD). */
export type WindowLeg = { linked: boolean; sameDay: boolean; day: string }

/**
 * One entry per deposit ref (`bankRef` is unique, so a deposit has at most one XFER_OUT leg).
 * Different-day linked legs are ignored: an adopted leg's deposit is already paired with a transfer.
 * @param legs cash-out legs read across the mirror window
 * @param transferDay UTC YYYY-MM-DD of the manual transfer
 * @returns map of deposit bank ref to its leg
 */
export function legsByDepositRef(
  legs: { bankRef: string | null; pettyCashTransferId: number | null; date: Date }[],
  transferDay: string,
): Map<string, WindowLeg> {
  const out = new Map<string, WindowLeg>()
  for (const l of legs) {
    const sameDay = utcYmd(l.date) === transferDay
    if (!l.bankRef || !(sameDay || l.pettyCashTransferId === null)) continue
    out.set(depositRefOfLeg(l.bankRef), { linked: l.pettyCashTransferId !== null, sameDay, day: utcYmd(l.date) })
  }
  return out
}
