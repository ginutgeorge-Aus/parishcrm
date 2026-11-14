// Personal roster calendar feed token (#628, part of #306). The URL carries
// only a random secret; the database keeps only its SHA-256 hash, so a DB read
// cannot rebuild a working link. Rotating overwrites the hash, which kills the
// old link at once. The secret has 192 bits of entropy, so a plain SHA-256
// (no salt, no KDF) is sufficient and lets the route find the row by index.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

/** Shape of a minted token: 24 random bytes as 32 base64url characters. */
export const ROSTER_FEED_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/

/** A fresh feed token: 24 CSPRNG bytes (192 bits) as 32 base64url characters. */
export function mintRosterFeedToken(): string {
  return randomBytes(24).toString("base64url")
}

/**
 * SHA-256 of a feed token, hex. This is what is stored and looked up.
 * @param token the plain token from the URL
 */
export function hashRosterFeedToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/**
 * Constant-time check that `token` hashes to `storedHash`. Both sides are
 * fixed-length hex digests, so the comparison time never depends on the input.
 * @param token the plain token from the URL
 * @param storedHash the hash held in the database
 */
export function rosterFeedTokenMatches(token: string, storedHash: string): boolean {
  if (!ROSTER_FEED_TOKEN_RE.test(token) || !storedHash) return false
  const a = Buffer.from(hashRosterFeedToken(token))
  const b = Buffer.from(storedHash)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Absolute feed URL for a token (base from AUTH_URL).
 * @param token the plain token
 * @returns the URL, or null when AUTH_URL is not a valid URL
 */
export function rosterFeedUrl(token: string): string | null {
  try {
    return new URL(`/api/roster/feed/${token}`, process.env.AUTH_URL ?? "http://localhost:3000").toString()
  } catch {
    return null
  }
}
