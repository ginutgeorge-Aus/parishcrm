// Keyed at-rest form of import bankRefs (#459). The pure rewrite lives in
// bankRefMask.ts; this module supplies the keyed digest (`hmacBankRefAccount`, a
// v1-derived blind index under its own label, distinct from the draft fingerprint
// that `hmacBankAccount` sends to the browser).
//
// Imports `./cryptoCore` directly (not the `server-only` `@/lib/crypto`) so the
// `scripts/hash-bankref-account.ts` backfill can share it under plain tsx —
// the same carve-out cryptoCore documents for ops scripts. Only server code
// (parse route, confirm pipeline) imports it from the app.
import { hmacBankRefAccount } from "./cryptoCore"
import { accountHashHead, accountOfStoredBankRef, hashBankRefWith, hashContentKeyWith } from "./bankRefMask"
import { XFER_OUT_PREFIX } from "./xferRefs"

/** User-facing message when the at-rest hash key cannot be derived (shared by parse + confirm). */
export const BANKREF_HASH_ERROR = "Bank import is unavailable: the server cannot derive its account-hash key. Contact an administrator."

/** The keyed at-rest digest could not be computed (the v1 blind-index key is unavailable). */
export class BankRefHashError extends Error {
  /** @param cause - the underlying crypto failure */
  constructor(cause: unknown) {
    super("bankRef hash key unavailable", { cause })
    this.name = "BankRefHashError"
  }
}

/**
 * `hmacBankRefAccount`, wrapping a key-derivation failure in a typed error so
 * callers can fail closed instead of surfacing an uncaught 500.
 *
 * @param accountNumber - plaintext account number
 * @returns hex digest
 * @throws BankRefHashError when the v1 key is unavailable
 */
function digestAccount(accountNumber: string): string {
  try {
    return hmacBankRefAccount(accountNumber)
  } catch (e) {
    throw new BankRefHashError(e)
  }
}

/** Hashing helpers that derive each account's keyed digest once (see createBankRefHasher). */
export type BankRefHasher = {
  /** Hash every occurrence of `accountNumber` in an import bankRef. */
  ref(ref: string, accountNumber: string): string
  /** Hash every occurrence of `accountNumber` in a content key (ParsedRow.dedupKey). */
  key(key: string, accountNumber: string): string
  /** Hash a stored ref using the account number from its own first segment. */
  stored(ref: string): string
}

/**
 * A hasher that computes `hmacBankRefAccount` (keyring load + HKDF + HMAC) once per
 * account number instead of once per row. Create one per request / script run
 * — it holds the digests only for its own lifetime, never across key changes.
 *
 * @returns the hasher
 */
export function createBankRefHasher(): BankRefHasher {
  const digests = new Map<string, string>()
  const digestOf = (accountNumber: string): string => {
    let digest = digests.get(accountNumber)
    if (digest === undefined) {
      digest = digestAccount(accountNumber)
      digests.set(accountNumber, digest)
    }
    return digest
  }
  const ref = (r: string, accountNumber: string) => (accountNumber ? hashBankRefWith(r, accountNumber, digestOf(accountNumber)) : r)
  const key = (k: string, accountNumber: string) => (accountNumber ? hashContentKeyWith(k, accountNumber, digestOf(accountNumber)) : k)
  const stored = (r: string) => {
    const accountNumber = accountOfStoredBankRef(r)
    if (accountNumber === null) return r
    if (r.startsWith(XFER_OUT_PREFIX)) return XFER_OUT_PREFIX + ref(r.slice(XFER_OUT_PREFIX.length), accountNumber)
    return ref(r, accountNumber)
  }
  return { ref, key, stored }
}

/**
 * The forms a full-number value may be stored under while legacy rows remain:
 * the hashed at-rest form first, then the legacy one (just one entry when
 * hashing changed nothing). Shared by the parse route and confirm dedup.
 * TODO(#459): drop the legacy form (return `[hashed]`) once the backfill has
 * run in every deployment — docs/operations.md, migration step 3.
 *
 * @param legacy - the full-number ref or content key
 * @param hashed - its hashed form
 * @returns lookup forms, hashed first
 */
export function dedupForms(legacy: string, hashed: string): string[] {
  return hashed === legacy ? [hashed] : [hashed, legacy]
}

/**
 * The hashed stand-in for an account number in a stored ref: `h` + the first 16
 * hex characters of its keyed HMAC (`hmacBankRefAccount`; format owned by `accountHashHead`).
 *
 * @param accountNumber - plaintext account number
 * @returns `h<16 hex>`
 */
export function accountHashToken(accountNumber: string): string {
  return accountHashHead(digestAccount(accountNumber))
}

/**
 * Hash every occurrence of `accountNumber` in an import bankRef (the write
 * format from #459). Refs of another account, QIF and non-import refs pass
 * through; an empty account number leaves the ref unchanged. One-off — use
 * `createBankRefHasher` for many rows.
 *
 * @param ref - full-number bankRef as built by a parser
 * @param accountNumber - the statement's account number
 * @returns the at-rest bankRef
 */
export function hashBankRef(ref: string, accountNumber: string): string {
  return createBankRefHasher().ref(ref, accountNumber)
}

/**
 * Hash every occurrence of `accountNumber` in a content key (ParsedRow.dedupKey),
 * matching `contentKeyFromBankRef(hashBankRef(ref))` for the same row.
 *
 * @param key - full-number content key
 * @param accountNumber - the statement's account number
 * @returns the at-rest content key
 */
export function hashContentKey(key: string, accountNumber: string): string {
  return createBankRefHasher().key(key, accountNumber)
}

/**
 * Hash a stored (or about-to-be-stored) bankRef using the account number from
 * its own first segment. Handles `XFER_OUT_` paired legs and `#n` split
 * siblings. Idempotent: an already-hashed, masked, QIF or non-import ref is
 * returned as-is. One-off — use `createBankRefHasher` for many rows.
 *
 * @param ref - a Transaction.bankRef value
 * @returns the at-rest bankRef
 */
export function hashStoredBankRef(ref: string): string {
  return createBankRefHasher().stored(ref)
}
