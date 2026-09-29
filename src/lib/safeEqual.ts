import { createHash, timingSafeEqual } from "node:crypto"

const digest = (s: string) => createHash("sha256").update(s).digest()

/**
 * Constant-time string compare for shared secrets. Fails closed on an unset
 * secret. Compares fixed-length SHA-256 digests, so a wrong-length guess takes
 * the same path as a right-length one and the secret's length isn't leaked.
 */
export function safeEqual(provided: string, secret: string): boolean {
  if (!secret) return false
  return timingSafeEqual(digest(provided), digest(secret))
}
