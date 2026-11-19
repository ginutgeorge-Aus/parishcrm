import { createHash, timingSafeEqual } from "node:crypto"

/**
 * SHA-256 hex digest of a share-link token. Tokens are 144+ bit CSPRNG values, so a plain
 * unsalted hash is enough: a stolen database backup holds digests, not usable links.
 * @param token the raw token from the URL
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/**
 * True when a value looks like a `hashToken` digest (64 hex chars, either case) rather than a legacy
 * raw token. Case-insensitive so an uppercased digest is never mistaken for a raw token.
 * @param stored value from the database or URL
 */
export function isHashedToken(stored: string): boolean {
  return /^[0-9a-f]{64}$/i.test(stored)
}

/**
 * The canonical stored form of a share-link token value: a lowercase digest. A legacy raw token is
 * hashed and an uppercased digest is lowercased (DB lookups compare verbatim against lowercase
 * `hashToken` output, so an uppercase digest would otherwise be a dead link). Used by the backfill.
 * @param stored value from the database
 * @returns the value to store, or null when `stored` is already canonical
 */
export function canonicalStoredToken(stored: string): string | null {
  const canonical = isHashedToken(stored) ? stored.toLowerCase() : hashToken(stored)
  return canonical === stored ? null : canonical
}

/**
 * Constant-time check of a URL token against a stored value. Accepts a legacy raw (pre-hash)
 * stored token until the backfill has hashed it; raw tokens are 24-32 base64url chars, never 64 hex.
 * @param provided token from the URL
 * @param stored digest (or legacy raw token) from the database
 */
export function storedTokenMatches(provided: string, stored: string): boolean {
  if (!provided || !stored) return false
  // Both sides are 64-hex digests, so the buffers are equal length and can be compared directly.
  const expected = Buffer.from(isHashedToken(stored) ? stored.toLowerCase() : hashToken(stored), "hex")
  const actual = Buffer.from(hashToken(provided), "hex")
  return timingSafeEqual(actual, expected)
}

/**
 * Stored values a URL token may match in a DB lookup: its digest, plus the raw token for legacy rows
 * not yet backfilled. A 64-hex URL token is never taken as raw: it would match a stolen digest.
 * Used for DB lookups (crew page); `storedTokenMatches` applies the same rule to an already-fetched value.
 * Sunset both raw branches together once the backfill is confirmed on every deployment.
 * @param token the raw token from the URL
 */
export function tokenLookupCandidates(token: string): string[] {
  return isHashedToken(token) ? [hashToken(token)] : [hashToken(token), token]
}
