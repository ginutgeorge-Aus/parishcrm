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

/**
 * Constant-time bearer-token check for the self-hosted cron routes. Shared by
 * every `/api/cron/*` sweep so the auth is identical across them. An unset
 * `CRON_SECRET` must fail closed, not accept an empty bearer.
 */
export function bearerOk(authorization: string | null, secret: string): boolean {
  const header = authorization ?? ""
  const prefix = "Bearer "
  if (!header.startsWith(prefix)) return false
  return safeEqual(header.slice(prefix.length), secret)
}
