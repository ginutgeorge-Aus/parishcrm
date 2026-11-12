const MAX_REF_LENGTH = 18
const DEFAULT_PREFIX = "FR"

/**
 * Build a bank-transfer reference: `<PREFIX><seq padded to 4>`.
 * Prefix is uppercased and stripped to [A-Z0-9] (empty -> "FR"). The total is
 * capped at 18 chars by truncating the prefix; the padded seq is always kept whole.
 * @param prefix free-text prefix, or null for the default
 * @param seq positive sequence number
 */
export function makeBankRef(prefix: string | null, seq: number): string {
  const clean = (prefix ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || DEFAULT_PREFIX
  const num = String(seq).padStart(4, "0")
  return clean.slice(0, Math.max(0, MAX_REF_LENGTH - num.length)) + num
}
