import { toCents } from "@/lib/formatting"
import { ymd } from "@/lib/dates"
import { XFER_OUT_PREFIX } from "@/lib/xferRefs"

/** Inverse of {@link xferOutRef}: the deposit bank ref a leg's `XFER_OUT_` bank ref points at. */
export function depositRefOfLeg(legBankRef: string): string {
  return legBankRef.slice(XFER_OUT_PREFIX.length)
}

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
    leg.type !== "EXPENSE" || leg.accountId !== ctx.xferAccountId || leg.paymentAccountId !== ctx.cashAccountId ||
    toCents(leg.amount.toFixed(2)) !== toCents(transfer.amount)
  )
    return "legMismatch"
  if (toCents(deposit.amount.toFixed(2)) !== toCents(transfer.amount) || ymd(deposit.date) !== ymd(transfer.date))
    return "depositMismatch"
  if (ymd(leg.date) !== ymd(transfer.date)) return "legDate"
  return null
}
