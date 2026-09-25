import { timingSafeEqual } from "crypto"

/**
 * Constant-time bearer-token check for the self-hosted cron routes. Shared by
 * every `/api/cron/*` sweep so the auth is identical across them.
 *
 * Length guard first — `timingSafeEqual` throws on unequal-length buffers. Never
 * authenticate against an unconfigured secret: an unset `CRON_SECRET`
 * must fail closed, not accept an empty bearer.
 */
export function bearerOk(authorization: string | null, secret: string): boolean {
  if (!secret) return false
  const header = authorization ?? ""
  const prefix = "Bearer "
  if (!header.startsWith(prefix)) return false
  const provided = Buffer.from(header.slice(prefix.length))
  const expected = Buffer.from(secret)
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}
