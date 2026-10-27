// Masking of the bank account number embedded in import bankRefs (#446).
//
// ANZ_/ANZTR_/OFX_ bankRefs (and their dedupKey content keys) start with the
// full account number: `<PREFIX>_<acct>_<date>_<amount>_<desc>_<suffix>`. The
// parse route keeps that full value server-side (DB rows store it, no
// migration) but sends the browser a masked copy whose account segment is
// `*<last4>`. The confirm step restores the real ref from a sealed account
// token (see bankAccountToken.ts) before any dedup/insert.
//
// Pure + client-safe on purpose: the review-draft loader (browser) uses
// `hasUnmaskedAccount` to discard drafts saved before masking existed.
// `*` never occurs in a real account segment (ANZ strips to digits, OFX to
// [A-Za-z0-9]) and the mask holds no `_`, so field positions are unchanged.

const PREFIX_RE = /^(?:ANZ|ANZTR|OFX|QIF)_/
// Prefixes whose account segment is a real bank account number. QIF uses
// `PA<paymentAccountId>` (an internal id), which is never sensitive.
const SENSITIVE_PREFIX_RE = /^(?:ANZ|ANZTR|OFX)_/
const MASK_SEGMENT_RE = /^\*[A-Za-z0-9]{1,4}$/

// Upper bound on a sealed account token's length (bankAccountToken.ts), checked
// by the confirm schema and the draft loader. A sealed ≤64-char number is ~120.
export const MAX_ACCOUNT_TOKEN_LENGTH = 512

/** The masked stand-in for an account number: `*` + its last 4 characters. */
export function accountMask(accountNumber: string): string {
  return `*${accountNumber.slice(-4)}`
}

/** Split a key into its first `_` segment and the remainder (starting at that `_`); null when there is no `_`. */
function splitFirstSegment(key: string): { head: string; rest: string } | null {
  const i = key.indexOf("_")
  if (i < 0) return null
  return { head: key.slice(0, i), rest: key.slice(i) }
}

/**
 * Mask a content key (`<acct>_<date>_<amount>_<desc>`, i.e. ParsedRow.dedupKey):
 * replaces the leading account segment with `*<last4>` when it equals
 * `accountNumber`. Anything else (empty account, other key) is returned as-is.
 */
export function maskContentKey(key: string, accountNumber: string): string {
  if (!accountNumber) return key
  const parts = splitFirstSegment(key)
  if (parts?.head !== accountNumber) return key
  return `${accountMask(accountNumber)}${parts.rest}`
}

/**
 * Mask an import bankRef (`ANZ_|ANZTR_|OFX_|QIF_` + content key + suffix):
 * the first segment after the prefix is replaced with `*<last4>` when it equals
 * `accountNumber`. Deterministic, so a re-parse of the same file yields the same
 * masked refs (the draft merge keys on bankRef). Non-import refs pass through.
 */
export function maskBankRef(ref: string, accountNumber: string): string {
  const prefix = PREFIX_RE.exec(ref)
  if (!prefix) return ref
  return prefix[0] + maskContentKey(ref.slice(prefix[0].length), accountNumber)
}

/** The `*<last4>` mask segment of a masked import bankRef, or null when the ref carries no mask. */
export function bankRefMaskSegment(ref: string): string | null {
  const prefix = PREFIX_RE.exec(ref)
  if (!prefix) return null
  const parts = splitFirstSegment(ref.slice(prefix[0].length))
  return parts && MASK_SEGMENT_RE.test(parts.head) ? parts.head : null
}

/**
 * Reverse of `maskBankRef`: rebuild the full-number bankRef. Returns the ref
 * unchanged when it carries no mask, and null when the mask does not match
 * `accountNumber`'s last 4 (a forged or cross-statement ref).
 */
export function unmaskBankRef(ref: string, accountNumber: string): string | null {
  const segment = bankRefMaskSegment(ref)
  if (segment === null) return ref
  if (!accountNumber || segment !== accountMask(accountNumber)) return null
  const prefix = PREFIX_RE.exec(ref)![0]
  return prefix + accountNumber + ref.slice(prefix.length + segment.length)
}

/**
 * True when an ANZ_/ANZTR_/OFX_ bankRef still embeds a raw (unmasked) account
 * number — i.e. a ref from before masking existed. Empty account segments
 * (statement with no account line) and QIF refs are not sensitive.
 */
export function hasUnmaskedAccount(ref: string): boolean {
  const prefix = SENSITIVE_PREFIX_RE.exec(ref)
  if (!prefix) return false
  const parts = splitFirstSegment(ref.slice(prefix[0].length))
  if (!parts) return false
  return parts.head !== "" && !MASK_SEGMENT_RE.test(parts.head)
}
