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
import { accountOfStoredBankRef, hashBankRefWith, hashContentKeyWith } from "./bankRefMask"
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
  // Lazy digest (#514): a ref/key that does not carry the account is returned
  // untouched without deriving (or failing on) the v1 key.
  const ref = (r: string, accountNumber: string) => (accountNumber ? hashBankRefWith(r, accountNumber, () => digestOf(accountNumber)) : r)
  const key = (k: string, accountNumber: string) => (accountNumber ? hashContentKeyWith(k, accountNumber, () => digestOf(accountNumber)) : k)
  const stored = (r: string) => {
    const accountNumber = accountOfStoredBankRef(r)
    if (accountNumber === null) return r
    if (r.startsWith(XFER_OUT_PREFIX)) return XFER_OUT_PREFIX + ref(r.slice(XFER_OUT_PREFIX.length), accountNumber)
    return ref(r, accountNumber)
  }
  return { ref, key, stored }
}

/**
 * Master switch for dual-format (hashed + legacy full-number) bankRef dedup
 * (#459, #511). While `true`, every dedup lookup also tries the legacy
 * plaintext-account form, so rows stored before the `hash-bankref-account`
 * backfill still match; that costs a second `bankRef IN` entry per row.
 *
 * This is the ONE place to change: the parse route, confirm `isDuplicate` and
 * the XFER_OUT pair check all go through `dedupForms`, which reads it.
 *
 * Removal criterion: flip to `false` (then delete the flag, the `includeLegacy`
 * argument of `dedupForms` and the legacy-ref bookkeeping in
 * `hashRowBankRefs`) once `scripts/audit-data-integrity.ts` reports "no
 * plaintext account numbers" for Transaction.bankRef on every known
 * deployment (St Mark prod + the public demo) and the self-hosting docs
 * (docs/operations.md, migration step 3) have told self-hosters to run the
 * backfill for at least one release.
 */
export const LEGACY_BANKREF_DEDUP = true

/**
 * The forms a full-number value may be stored under while legacy rows remain:
 * the hashed at-rest form first, then the legacy one (just one entry when
 * hashing changed nothing or legacy dedup is off). Shared by the parse route
 * and confirm dedup.
 *
 * @param legacy - the full-number ref or content key
 * @param hashed - its hashed form
 * @param includeLegacy - include the legacy form; defaults to `LEGACY_BANKREF_DEDUP`
 * @returns lookup forms, hashed first
 */
export function dedupForms(legacy: string, hashed: string, includeLegacy: boolean = LEGACY_BANKREF_DEDUP): string[] {
  return includeLegacy && hashed !== legacy ? [hashed, legacy] : [hashed]
}
