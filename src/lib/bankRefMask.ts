// Masking of the bank account number embedded in import bankRefs (#446).
//
// ANZ_/ANZTR_/OFX_ bankRefs (and their dedupKey content keys) start with the
// full account number: `<PREFIX>_<acct>_<date>_<amount>_<desc>_<suffix>`. The
// parse route keeps that full value server-side (dedup; the DB stores a hashed
// form, see the #459 section at the end) but sends the browser a masked copy whose account segment is
// `*<last4>`. The confirm step restores the real ref from a sealed account
// token (see bankAccountToken.ts) before any dedup/insert.
//
// Pure + client-safe on purpose: the review-draft loader (browser) uses
// `hasUnmaskedAccount` to discard drafts saved before masking existed.
// `*` never occurs in a real account segment (ANZ strips to digits, OFX to
// [A-Za-z0-9]) and the mask holds no `_`, so field positions are unchanged.
//
// #449: the number can also appear later in a ref (the upper-cased, 20-char
// description segment — possibly cut off part-way — and the OFX FITID suffix)
// and in row description/details text. Every occurrence in a ref is masked
// case-insensitively, as a token that records how to restore it exactly:
//   `*<last4>`        the account number as-is
//   `*<last4>.U|.D`   its upper/lower-cased form
//   `*<last4>.M<bits>` mixed case (one 1/0 per character: upper/lower)
//   `*<last4>.P<n>`   the first n characters (upper-cased), cut off at the
//                      end of a truncated description segment
// `*` and `.` never occur in a genuine description/suffix segment (both are
// stripped to [A-Za-z0-9]; pinned by a test across every parser), so the
// tokens are unambiguous and unmasking is an exact reverse. Free text is
// masked one-way (`makeAccountTextMasker`) — confirm stores it as sent.

import { XFER_OUT_PREFIX as XFER_OUT_REF_PREFIX } from "./xferRefs"

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
/** Max length of the description segment of a content key (`bankRefContentKey` truncates to this). */
export const DESC_SEGMENT_MAX = 20
// Content-key segment index of the description; later segments are the ref suffix.
const DESC_SEGMENT_INDEX = 3
// Shortest cut-off account prefix worth masking at the end of a truncated description.
const MIN_PARTIAL_MASK_LENGTH = 4

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

/** Case tag for a case-insensitive match `m` of `accountNumber` (see the token table above). */
function caseTag(m: string, accountNumber: string): string {
  if (m === accountNumber) return ""
  if (m === accountNumber.toUpperCase()) return ".U"
  if (m === accountNumber.toLowerCase()) return ".D"
  return `.M${[...m].map((c) => (c === c.toLowerCase() ? "0" : "1")).join("")}`
}

/**
 * How a content-key rewrite spells the account number: `head` replaces the
 * leading account segment, `full(match)` each inline (case-insensitive) match,
 * `partial(n)` an n-character prefix cut off at the end of a truncated
 * description. The browser mask and the at-rest hash (#459) differ only here.
 */
type AccountTokens = { head: string; full: (match: string) => string; partial: (n: number) => string }

/** The restorable `*<last4>` tokens sent to the browser (see the table above). */
function maskTokens(accountNumber: string): AccountTokens {
  const mask = accountMask(accountNumber)
  return { head: mask, full: (m) => mask + caseTag(m, accountNumber), partial: (n) => `${mask}.P${n}` }
}

/** Replace every case-insensitive occurrence of `accountNumber` in one ref segment with `tokens.full`. */
function replaceSegmentOccurrences(segment: string, accountNumber: string, tokens: AccountTokens): string {
  const haystack = segment.toLowerCase()
  const needle = accountNumber.toLowerCase()
  let out = ""
  let from = 0
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, from)) {
    out += segment.slice(from, at) + tokens.full(segment.slice(at, at + needle.length))
    from = at + needle.length
  }
  return out + segment.slice(from)
}

/**
 * Rewrite a description or suffix segment: every full occurrence, plus — for a
 * description cut at `DESC_SEGMENT_MAX` — a trailing prefix of the (upper-cased)
 * account number of at least `MIN_PARTIAL_MASK_LENGTH` characters.
 */
function replaceTailSegment(segment: string, accountNumber: string, isDesc: boolean, tokens: AccountTokens): string {
  if (isDesc && segment.length === DESC_SEGMENT_MAX) {
    const upper = accountNumber.toUpperCase()
    for (let n = Math.min(upper.length - 1, segment.length); n >= MIN_PARTIAL_MASK_LENGTH; n--) {
      if (segment.endsWith(upper.slice(0, n))) {
        return `${replaceSegmentOccurrences(segment.slice(0, -n), accountNumber, tokens)}${tokens.partial(n)}`
      }
    }
  }
  return replaceSegmentOccurrences(segment, accountNumber, tokens)
}

/**
 * Rewrite every account-number occurrence in a content key (or key + suffix)
 * with `tokens`: the leading segment when it equals `accountNumber`, and — for
 * numbers of 6+ characters — every occurrence in the description and suffix
 * segments. Keys whose first segment is not `accountNumber` are returned as-is.
 */
function rewriteContentKey(key: string, accountNumber: string, tokens: AccountTokens): string {
  if (!accountNumber) return key
  const parts = key.split("_")
  if (parts.length < 2 || parts[0] !== accountNumber) return key
  parts[0] = tokens.head
  if (accountNumber.length >= MIN_INLINE_MASK_LENGTH) {
    for (let i = DESC_SEGMENT_INDEX; i < parts.length; i++) {
      parts[i] = replaceTailSegment(parts[i], accountNumber, i === DESC_SEGMENT_INDEX, tokens)
    }
  }
  return parts.join("_")
}

/**
 * Mask a content key (`<acct>_<date>_<amount>_<desc>`, i.e. ParsedRow.dedupKey,
 * or the same plus `_<suffix>` when called via `maskBankRef`): the leading
 * account segment becomes `*<last4>` when it equals `accountNumber`, and for
 * numbers of 6+ characters every occurrence in the description and suffix
 * segments (incl. one cut off by description truncation) becomes a restorable
 * token. Anything else (empty account, other key) is returned as-is.
 */
export function maskContentKey(key: string, accountNumber: string): string {
  if (!accountNumber) return key
  return rewriteContentKey(key, accountNumber, maskTokens(accountNumber))
}

/**
 * Build a one-way masker for free text sent to the browser (row
 * description/details, #449), compiled once per statement. Masks the account
 * number as a whole token — not part of a longer alphanumeric run, so
 * "1987654321-005" is left alone — case-insensitively, allowing a short run of
 * any non-alphanumeric separators between characters ("9876-54321",
 * "987/654/321", "98765_4321"). The masked text is what the review shows and
 * what confirm stores. Numbers under 6 characters are never masked (would
 * mangle ordinary text). null/undefined text yields "".
 */
export function makeAccountTextMasker(accountNumber: string): (text: string | null | undefined) => string {
  if (accountNumber.length < MIN_INLINE_MASK_LENGTH || !ACCOUNT_CHARS_RE.test(accountNumber)) return (text) => text ?? ""
  // Built only from [A-Za-z0-9] literals plus a fixed, bounded separator class
  // between them: no metacharacters from input, no nested quantifiers.
  const body = [...accountNumber].join("[^A-Za-z0-9]{0,3}")
  const pattern = new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "gi") // nosemgrep
  const mask = accountMask(accountNumber)
  return (text) => (text ? text.replace(pattern, mask) : "")
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

/** Undo one inline token (see the table above): `tag` is the text after `.`, if any. */
function restoreToken(accountNumber: string, tag: string | undefined): string {
  if (!tag) return accountNumber
  if (tag === "U") return accountNumber.toUpperCase()
  if (tag === "D") return accountNumber.toLowerCase()
  if (tag.startsWith("P")) return accountNumber.toUpperCase().slice(0, Number(tag.slice(1)))
  const bits = tag.slice(1)
  return [...accountNumber].map((c, i) => (bits[i] === "1" ? c.toUpperCase() : c.toLowerCase())).join("")
}

/**
 * Reverse of `maskBankRef`: rebuild the full-number bankRef, restoring the
 * leading segment and every inline token. Returns the ref unchanged when it
 * carries no leading mask, and null when the mask does not match
 * `accountNumber`'s last 4 or a stray `*` is left over (a forged or
 * cross-statement ref).
 */
export function unmaskBankRef(ref: string, accountNumber: string): string | null {
  const segment = bankRefMaskSegment(ref)
  if (segment === null) return ref
  if (!accountNumber || segment !== accountMask(accountNumber)) return null
  const prefix = SENSITIVE_PREFIX_RE.exec(ref)![0]
  const body = ref.slice(prefix.length + segment.length)
  // The mask is `*` + up to 4 [A-Za-z0-9] (account charset), so the only
  // metacharacter to escape is the `*`. The M tag carries exactly one bit per
  // account character, so it can't swallow suffix text after it.
  const token = new RegExp( // nosemgrep
    String.raw`\*${segment.slice(1)}(?:\.(U|D|P\d{1,2}|M[01]{${accountNumber.length}}))?`,
    "g"
  )
  const restored = prefix + accountNumber + body.replace(token, (_m, tag: string | undefined) => restoreToken(accountNumber, tag))
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

// ── At-rest hashed format (#459) ────────────────────────────────────────────
// Stored Transaction.bankRef values replace every account-number occurrence
// with `h<first 16 hex of hmacBankAccount(acct)>` (a keyed blind index, see
// bankRefHash.ts) — `h<hex>p<n>` for a prefix cut off by description
// truncation. Deterministic, so exact-ref and content-key dedup keep working.
// One-way: nothing ever needs the number back. Lower-case `h` + hex cannot be
// confused with an upper-cased description, and a real account segment (ANZ
// digits only) never looks like one, so the backfill can tell rows apart.

/** A hashed leading account segment: `h` + 16 lowercase hex. */
export const HASHED_ACCOUNT_RE = /^h[0-9a-f]{16}$/
const HASH_TOKEN_HEX = 16

/**
 * The hashed stand-in for an account number (the single source of the token
 * format): `h` + the first HASH_TOKEN_HEX hex characters of its HMAC digest.
 *
 * @param digest - hex `hmacBankAccount(accountNumber)`
 * @returns `h<16 hex>`
 */
export function accountHashHead(digest: string): string {
  return `h${digest.slice(0, HASH_TOKEN_HEX)}`
}

/** The hashed-format tokens for one account, from its hex HMAC digest. */
function hashTokens(digest: string): AccountTokens {
  const head = accountHashHead(digest)
  return { head, full: () => head, partial: (n) => `${head}p${n}` }
}

/**
 * Hash a content key (`<acct>_<date>_<amount>_<desc>`, optionally + suffix):
 * every occurrence of `accountNumber` becomes the hashed token built from
 * `digest` (hex HMAC of the number). Pure; the keyed digest comes from
 * bankRefHash.ts. Keys of another account are returned as-is.
 *
 * @param key - content key / ref body
 * @param accountNumber - the account number embedded in the key
 * @param digest - hex `hmacBankAccount(accountNumber)`
 * @returns the hashed key
 */
export function hashContentKeyWith(key: string, accountNumber: string, digest: string): string {
  if (!accountNumber) return key
  return rewriteContentKey(key, accountNumber, hashTokens(digest))
}

/**
 * Hash an import bankRef (`ANZ_|ANZTR_|OFX_|QIF_` + content key + suffix,
 * incl. a `#n` split-sibling suffix) — see `hashContentKeyWith`. Non-import
 * refs pass through.
 *
 * @param ref - full-number bankRef
 * @param accountNumber - the account number embedded in the ref
 * @param digest - hex `hmacBankAccount(accountNumber)`
 * @returns the hashed bankRef
 */
export function hashBankRefWith(ref: string, accountNumber: string, digest: string): string {
  const prefix = IMPORT_REF_PREFIX_RE.exec(ref)
  if (!prefix) return ref
  return prefix[0] + hashContentKeyWith(ref.slice(prefix[0].length), accountNumber, digest)
}

/**
 * The plaintext account number of a stored legacy ANZ_/ANZTR_/OFX_ bankRef
 * (optionally an `XFER_OUT_` paired leg), read from its first segment; null when
 * there is none to hash — already hashed, masked, empty, QIF or a non-import ref.
 *
 * @param ref - a stored Transaction.bankRef
 * @returns the account number, or null
 */
export function accountOfStoredBankRef(ref: string): string | null {
  const body = ref.startsWith(XFER_OUT_REF_PREFIX) ? ref.slice(XFER_OUT_REF_PREFIX.length) : ref
  const prefix = SENSITIVE_PREFIX_RE.exec(body)
  if (!prefix) return null
  const parts = splitFirstSegment(body.slice(prefix[0].length))
  if (!parts || parts.head === "" || MASK_SEGMENT_RE.test(parts.head) || HASHED_ACCOUNT_RE.test(parts.head)) return null
  return parts.head
}
