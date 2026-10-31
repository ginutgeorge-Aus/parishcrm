// Keyed at-rest form of import bankRefs (#459). The pure rewrite lives in
// bankRefMask.ts; this module supplies the keyed digest (`hmacBankAccount`, the
// v1-derived blind index already used for the draft fingerprint).
//
// Imports `./cryptoCore` directly (not the `server-only` `@/lib/crypto`) so the
// `scripts/hash-bankref-account.ts` backfill can share it under plain tsx —
// the same carve-out cryptoCore documents for ops scripts. Only server code
// (parse route, confirm pipeline) imports it from the app.
import { hmacBankAccount } from "./cryptoCore"
import { accountOfStoredBankRef, hashBankRefWith, hashContentKeyWith } from "./bankRefMask"
import { XFER_OUT_PREFIX } from "./xferRefs"

/**
 * The hashed stand-in for an account number in a stored ref: `h` + the first 16
 * hex characters of its keyed HMAC.
 *
 * @param accountNumber - plaintext account number
 * @returns `h<16 hex>`
 */
export function accountHashToken(accountNumber: string): string {
  return `h${hmacBankAccount(accountNumber).slice(0, 16)}`
}

/**
 * Hash every occurrence of `accountNumber` in an import bankRef (the write
 * format from #459). Refs of another account, QIF and non-import refs pass
 * through; an empty account number leaves the ref unchanged.
 *
 * @param ref - full-number bankRef as built by a parser
 * @param accountNumber - the statement's account number
 * @returns the at-rest bankRef
 */
export function hashBankRef(ref: string, accountNumber: string): string {
  if (!accountNumber) return ref
  return hashBankRefWith(ref, accountNumber, hmacBankAccount(accountNumber))
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
  if (!accountNumber) return key
  return hashContentKeyWith(key, accountNumber, hmacBankAccount(accountNumber))
}

/**
 * Hash a stored (or about-to-be-stored) bankRef using the account number from
 * its own first segment — the backfill and confirm path, which have no separate
 * account number. Handles `XFER_OUT_` paired legs and `#n` split siblings.
 * Idempotent: an already-hashed, masked, QIF or non-import ref is returned as-is.
 *
 * @param ref - a Transaction.bankRef value
 * @returns the at-rest bankRef
 */
export function hashStoredBankRef(ref: string): string {
  const accountNumber = accountOfStoredBankRef(ref)
  if (accountNumber === null) return ref
  if (ref.startsWith(XFER_OUT_PREFIX)) return XFER_OUT_PREFIX + hashBankRef(ref.slice(XFER_OUT_PREFIX.length), accountNumber)
  return hashBankRef(ref, accountNumber)
}
