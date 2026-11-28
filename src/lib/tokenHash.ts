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
 * Constant-time check of a URL token against a stored digest. The legacy raw (pre-hash) stored-token
 * branch is gone (#800): a stored value that is not a 64-hex digest never matches.
 * @param provided token from the URL
 * @param stored digest from the database
 */
export function storedTokenMatches(provided: string, stored: string): boolean {
  if (!provided || !stored || !isHashedToken(stored)) return false
  // Both sides are 64-hex digests, so the buffers are equal length and can be compared directly.
  const expected = Buffer.from(stored.toLowerCase(), "hex")
  const actual = Buffer.from(hashToken(provided), "hex")
  return timingSafeEqual(actual, expected)
}
