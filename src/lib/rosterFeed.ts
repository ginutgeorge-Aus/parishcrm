// Personal roster calendar feed token (#628, part of #306). The URL carries
// only a random secret; the database keeps only its SHA-256 hash, so a DB read
// cannot rebuild a working link. Rotating overwrites the hash, which kills the
// old link at once. The secret has 192 bits of entropy, so a plain SHA-256
// (no salt, no KDF) is sufficient. The route finds the row by its unique hash
// index, so the database equality lookup is the comparison: no secret is ever
// compared byte by byte in app code, and timing reveals nothing about the token.

import { createHash, randomBytes } from "node:crypto"

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
 * Absolute feed URL for a token (base from AUTH_URL). No localhost fallback:
 * a link built from a guessed base would be wrong for the person who gets it.
 * @param token the plain token
 * @returns the URL, or null when AUTH_URL is unset or not a valid URL
 */
export function rosterFeedUrl(token: string): string | null {
  if (!process.env.AUTH_URL) return null
  try {
    return new URL(`/api/roster/feed/${token}`, process.env.AUTH_URL).toString()
  } catch {
    return null
  }
}
