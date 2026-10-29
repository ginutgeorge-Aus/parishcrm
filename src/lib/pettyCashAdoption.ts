import { toCents } from "@/lib/formatting"

/** Calendar day (YYYY-MM-DD) of a date stored at UTC midnight; robust to a time component. */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export type AdoptionMismatch = "reconciled" | "account" | "amount" | "date"

/**
 * Why a bank-import XFER_OUT leg cannot be adopted as the ledger mirror of a
 * petty cash transfer for `target`, or null when it can. A leg is adoptable
 * when it is unreconciled, sits on the cash payment account, and agrees with
 * the target on amount and calendar day. Shared by createTransfer (target =
 * the entered transfer) and the candidate loader (target = the deposit) so the
 * picker never offers a pair createTransfer would reject.
 */
export function adoptionMismatch(
  leg: { reconciled: boolean; paymentAccountId: number | null; amount: { toFixed(n: number): string }; date: Date },
  target: { amount: string; date: Date },
  cashAccountId: number | null,
): AdoptionMismatch | null {
  if (leg.reconciled) return "reconciled"
  if (leg.paymentAccountId !== cashAccountId) return "account"
  if (toCents(leg.amount.toFixed(2)) !== toCents(target.amount)) return "amount"
  if (ymd(leg.date) !== ymd(target.date)) return "date"
  return null
}
