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
//
// #449: the number can also appear later in a ref (OFX FITID suffix, the
// description segment) and in row description/details text. Every occurrence
// in a ref is masked; since `*` never occurs in a genuine ref (descriptions
// and FITIDs are stripped to [A-Za-z0-9]), unmasking is an exact reverse.
// Free text is masked one-way (`maskAccountInText`) — confirm stores it as sent.

/** Every import-ref prefix (ANZ/ANZTR/OFX/QIF); shared with `contentKeyFromBankRef` in anzParser.ts. */
export const IMPORT_REF_PREFIX_RE = /^(?:ANZ|ANZTR|OFX|QIF)_/
// Prefixes whose account segment is a real bank account number. QIF uses
// `PA<paymentAccountId>` (an internal id), which is never sensitive.
const SENSITIVE_PREFIX_RE = /^(?:ANZ|ANZTR|OFX)_/
const MASK_SEGMENT_RE = /^\*[A-Za-z0-9]{1,4}$/
// Occurrences beyond the leading account segment are only masked for numbers
// at least this long — a short value would match arbitrary digits elsewhere.
const MIN_INLINE_MASK_LENGTH = 6
const ACCOUNT_CHARS_RE = /^[A-Za-z0-9]+$/

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

/** Replace every later occurrence of a long-enough account number in `s` with its mask (ref text only: case-sensitive, exact). */
function maskInline(s: string, accountNumber: string): string {
  return accountNumber.length >= MIN_INLINE_MASK_LENGTH ? s.replaceAll(accountNumber, accountMask(accountNumber)) : s
}

/**
 * Mask a content key (`<acct>_<date>_<amount>_<desc>`, i.e. ParsedRow.dedupKey):
 * replaces the leading account segment with `*<last4>` when it equals
 * `accountNumber`, plus any later occurrence (description segment, OFX FITID
 * suffix when called via `maskBankRef`) for numbers of 6+ characters.
 * Anything else (empty account, other key) is returned as-is.
 */
export function maskContentKey(key: string, accountNumber: string): string {
  if (!accountNumber) return key
  const parts = splitFirstSegment(key)
  if (parts?.head !== accountNumber) return key
  return `${accountMask(accountNumber)}${maskInline(parts.rest, accountNumber)}`
}

/**
 * Mask the account number wherever it appears in free text sent to the browser
 * (row description/details, #449). Tolerates the usual separators between
 * digits ("9876-54321", "98765 4321") and ignores case. One-way: the masked
 * text is what the review shows and what confirm stores. Numbers under 6
 * characters are left alone to avoid mangling ordinary text.
 */
export function maskAccountInText(text: string, accountNumber: string): string {
  if (accountNumber.length < MIN_INLINE_MASK_LENGTH || !ACCOUNT_CHARS_RE.test(accountNumber)) return text
  // Built only from [A-Za-z0-9] plus a fixed optional separator class: no
  // metacharacters, no nested quantifiers (linear match).
  const pattern = new RegExp([...accountNumber].join(String.raw`[\s.-]?`), "gi") // nosemgrep
  return text.replace(pattern, accountMask(accountNumber))
}

/**
 * Mask an import bankRef (`ANZ_|ANZTR_|OFX_|QIF_` + content key + suffix):
 * the first segment after the prefix is replaced with `*<last4>` when it equals
 * `accountNumber`. Deterministic, so a re-parse of the same file yields the same
 * masked refs (the draft merge keys on bankRef). Non-import refs pass through.
 */
export function maskBankRef(ref: string, accountNumber: string): string {
  const prefix = IMPORT_REF_PREFIX_RE.exec(ref)
  if (!prefix) return ref
  return prefix[0] + maskContentKey(ref.slice(prefix[0].length), accountNumber)
}

/** The `*<last4>` mask segment of a masked ANZ_/ANZTR_/OFX_ bankRef, or null when the ref carries no mask (QIF refs never do). */
export function bankRefMaskSegment(ref: string): string | null {
  const prefix = SENSITIVE_PREFIX_RE.exec(ref)
  if (!prefix) return null
  const parts = splitFirstSegment(ref.slice(prefix[0].length))
  return parts && MASK_SEGMENT_RE.test(parts.head) ? parts.head : null
}

/**
 * Reverse of `maskBankRef`: rebuild the full-number bankRef, restoring every
 * masked occurrence (leading segment and any inline ones). Returns the ref
 * unchanged when it carries no leading mask, and null when the mask does not
 * match `accountNumber`'s last 4 or a stray `*` is left over (a forged or
 * cross-statement ref).
 */
export function unmaskBankRef(ref: string, accountNumber: string): string | null {
  const segment = bankRefMaskSegment(ref)
  if (segment === null) return ref
  if (!accountNumber || segment !== accountMask(accountNumber)) return null
  const prefix = SENSITIVE_PREFIX_RE.exec(ref)![0]
  const restored = prefix + ref.slice(prefix.length).replaceAll(segment, accountNumber)
  return restored.includes("*") ? null : restored
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
