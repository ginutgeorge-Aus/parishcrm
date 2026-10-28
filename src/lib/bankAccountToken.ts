import "server-only"
import { decrypt, encrypt, hmacBankAccount, keyIdOf } from "@/lib/crypto"
import { MAX_ACCOUNT_TOKEN_LENGTH } from "@/lib/bankRefMask"

// Sealed bank-account token (#446). The parse route hands the browser masked
// bankRefs (`*<last4>` in place of the account number) plus this AES-256-GCM
// token; the confirm step unseals it to rebuild the real refs. The key is
// server-only, so the token is opaque to the client and safe in sessionStorage.
//
// The plaintext is purpose-bound (`bank-acct:v1:<n>`) so no other ciphertext
// the app produces (encrypted notes, emails, …) can be replayed as a token.

const PURPOSE = "bank-acct:v1:"
const ACCOUNT_RE = /^[A-Za-z0-9]{1,64}$/

/** Seal a bank account number into an opaque, purpose-bound token for the client. */
export function sealAccountNumber(accountNumber: string): string {
  return encrypt(`${PURPOSE}${accountNumber}`)
}

/**
 * Unseal a token from `sealAccountNumber`. Returns null for anything that is not
 * a genuine, untampered bank-account token: wrong type/length, not ciphertext
 * (`decrypt` would pass plaintext straight through), a failed GCM auth tag, the
 * wrong purpose prefix, or an implausible account number.
 */
export function unsealAccountNumber(token: unknown): string | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_ACCOUNT_TOKEN_LENGTH) return null
  if (keyIdOf(token) === null) return null
  let plaintext: string
  try {
    plaintext = decrypt(token)
  } catch {
    return null
  }
  if (!plaintext.startsWith(PURPOSE)) return null
  const accountNumber = plaintext.slice(PURPOSE.length)
  return ACCOUNT_RE.test(accountNumber) ? accountNumber : null
}

/**
 * Deterministic, non-reversible fingerprint of the statement's account number
 * (#449), returned with the parse response so the review draft only merges
 * selections from a re-upload of the SAME account — masked refs (`*<last4>`)
 * alone collide for two accounts sharing their last 4 digits.
 */
export function fingerprintAccountNumber(accountNumber: string): string {
  return hmacBankAccount(accountNumber)
}
