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
