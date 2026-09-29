import { timingSafeEqual } from "node:crypto"

/**
 * Constant-time string compare for shared secrets. Fails closed on an unset
 * secret. Length guard first — `timingSafeEqual` throws on unequal lengths.
 */
export function safeEqual(provided: string, secret: string): boolean {
  if (!secret) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
