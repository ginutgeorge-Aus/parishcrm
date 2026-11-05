import { utcYmd } from "@/lib/dates"

/** Prefix of the paired petty-cash cash-out leg written by bank import (`XFER_OUT_<bankRef>`). */
export const XFER_OUT_PREFIX = "XFER_OUT_"

/**
 * Half-width (ms) of the ±7-day window (inclusive) in which a bank-import deposit and a session-transfer
 * mirror are treated as the same cash movement. Shared by confirmBankImport and the manual-transfer guard.
 */
export const XFER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Fragment present in the cross-day window-guard error (and only it), so the form can offer the admin override. */
export const WINDOW_GUARD_TAG = "(within 7 days of this transfer)"

/**
 * Bank ref of the XFER_OUT cash-out leg paired with the imported deposit `depositBankRef`.
 * @param depositBankRef bank ref of the imported deposit
 * @returns the paired leg's bank ref
 */
export function xferOutRef(depositBankRef: string): string {
  return `${XFER_OUT_PREFIX}${depositBankRef}`
}

/**
 * Inverse of {@link xferOutRef}: the deposit bank ref a leg's `XFER_OUT_` bank ref points at.
 * @param legBankRef bank ref of the XFER_OUT leg
 * @returns the paired deposit's bank ref
 */
export function depositRefOfLeg(legBankRef: string): string {
  return legBankRef.slice(XFER_OUT_PREFIX.length)
}

/** Per-deposit summary of the cash-out legs the manual guard found in the window. */
export type WindowLeg = { linked: boolean; sameDay: boolean }

/** Guard priority: same-day unlinked (3) > different-day unlinked (2) > linked/adopted (1). */
function legPriority(l: WindowLeg): number {
  return !l.linked && l.sameDay ? 3 : !l.linked ? 2 : 1
}

/**
 * One entry per deposit ref, keeping the highest-priority leg so the guard's error never depends on
 * query order when a deposit has several legs in the window. Different-day linked legs are ignored.
 * @param legs cash-out legs read across the mirror window
 * @param transferDay UTC YYYY-MM-DD of the manual transfer
 * @returns map of deposit bank ref to its winning leg
 */
export function legsByDepositRef(
  legs: { bankRef: string | null; pettyCashTransferId: number | null; date: Date }[],
  transferDay: string,
): Map<string, WindowLeg> {
  const out = new Map<string, WindowLeg>()
  for (const l of legs) {
    const sameDay = utcYmd(l.date) === transferDay
    if (!l.bankRef || !(sameDay || l.pettyCashTransferId === null)) continue
    const cand = { linked: l.pettyCashTransferId !== null, sameDay }
    const ref = depositRefOfLeg(l.bankRef)
    const cur = out.get(ref)
    if (!cur || legPriority(cand) > legPriority(cur)) out.set(ref, cand)
  }
  return out
}
