import { createHash, timingSafeEqual } from "node:crypto"

/**
 * SHA-256 hex digest of a share-link token. Tokens are 144+ bit CSPRNG values, so a plain
 * unsalted hash is enough: a stolen database backup holds digests, not usable links.
 * @param token the raw token from the URL
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** True when a stored value is a `hashToken` digest (64 hex chars) rather than a legacy raw token. */
export function isHashedToken(stored: string): boolean {
  return /^[0-9a-f]{64}$/.test(stored)
}

/**
 * Constant-time check of a URL token against a stored value. Accepts a legacy raw (pre-hash)
 * stored token until the backfill has hashed it; raw tokens are 24-32 base64url chars, never 64 hex.
 * @param provided token from the URL
 * @param stored digest (or legacy raw token) from the database
 */
export function storedTokenMatches(provided: string, stored: string): boolean {
  if (!provided || !stored) return false
  // Both sides are 64-char hex digests, so equal lengths and a direct constant-time compare is safe.
  const expected = Buffer.from(isHashedToken(stored) ? stored : hashToken(stored))
  const actual = Buffer.from(hashToken(provided))
  return timingSafeEqual(actual, expected)
}

/**
 * Stored values a URL token may match in a DB lookup: its digest, plus the raw token for legacy rows
 * not yet backfilled. A 64-hex URL token is never taken as raw: it would match a stolen digest.
 * Single source of the "digest or legacy raw" rule (sunset the raw branch once the backfill is confirmed).
 * @param token the raw token from the URL
 */
export function tokenLookupCandidates(token: string): string[] {
  return isHashedToken(token) ? [hashToken(token)] : [hashToken(token), token]
}
