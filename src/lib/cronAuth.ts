import { safeEqual } from "@/lib/safeEqual"

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
