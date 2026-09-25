import "server-only"

/**
 * Cloudflare Turnstile server-side verification.
 *
 * Optional CAPTCHA as defence-in-depth on the public event registration form,
 * layered on top of the honeypot field + signed timing token. DISABLED
 * unless `TURNSTILE_SECRET_KEY` is set — local/dev/tests bypass it entirely and
 * never call Cloudflare, so nothing to configure to run the app.
 *
 * When enabled it fails closed: a missing token, a non-ok HTTP response, or any
 * network/parse error all return false. The register route maps that to the same
 * generic 400 as the honeypot, never hinting which check failed.
 */
const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify"

/** True when Turnstile is configured (secret key present). */
export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY)
}

/**
 * Verify a Turnstile response token with Cloudflare. Returns true (bypass) when
 * Turnstile is disabled; otherwise true only on a confirmed `success` verdict.
 */
export async function verifyTurnstile(
  token: unknown,
  ip?: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true // disabled — bypass
  if (typeof token !== "string" || token.length === 0) return false

  const form = new URLSearchParams()
  form.set("secret", secret)
  form.set("response", token)
  if (ip) form.set("remoteip", ip)

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      // Node's fetch has no default timeout — a hung Cloudflare siteverify would
      // otherwise pin the unauthenticated register worker indefinitely.
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}
