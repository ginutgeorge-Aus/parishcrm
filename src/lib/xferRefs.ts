/** Prefix of the paired petty-cash cash-out leg written by bank import (`XFER_OUT_<bankRef>`). */
export const XFER_OUT_PREFIX = "XFER_OUT_"

/**
 * Bank ref of the XFER_OUT cash-out leg paired with the imported deposit `depositBankRef`.
 * @param depositBankRef bank ref of the imported deposit
 * @returns the paired leg's bank ref
 */
export function xferOutRef(depositBankRef: string): string {
  return `${XFER_OUT_PREFIX}${depositBankRef}`
}
