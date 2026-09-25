import "server-only"

/**
 * Stateless, signed form token for public-form bot protection.
 *
 * The public event registration form has no auth and only an in-process IP
 * rate limit (single-replica). This adds a timing trap: the server issues an
 * HMAC-signed timestamp when it renders the form, and the register route
 * rejects submissions that arrive implausibly fast (bots) or with a missing /
 * forged / stale token. Combined with the honeypot field in RegistrationForm,
 * it raises the cost of scripted spam without a CAPTCHA or external service.
 *
 * Signed (not just a raw timestamp) so a bot can't fabricate an old timestamp
 * to skip the delay. Stateless (HMAC over the timestamp) so it works across
 * replica restarts and needs no shared store.
 */
import { createHmac, timingSafeEqual } from "crypto"

// A human must pick tickets and type name + email — sub-3s submission is a bot.
const MIN_FILL_MS = 3_000
// Forms left open longer than this must be refreshed (token re-issued).
const MAX_AGE_MS = 2 * 60 * 60 * 1000

function sign(ts: string): string {
  // NEXTAUTH_SECRET fallback: a half-renamed prod env must never silently
  // fall back to an empty key — an empty HMAC key lets anyone forge a token.
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is required to sign form tokens")
  return createHmac("sha256", secret).update(ts).digest("base64url")
}

/** Issue a token stamped with `nowMs` (pass Date.now()). Embed in the form. */
export function issueFormToken(nowMs: number): string {
  const ts = String(nowMs)
  return `${ts}.${sign(ts)}`
}

export type FormTokenResult = "ok" | "missing" | "bad" | "tooFast" | "expired"

/** Verify a submitted token against `nowMs` (pass Date.now()). */
export function verifyFormToken(token: unknown, nowMs: number): FormTokenResult {
  if (typeof token !== "string" || token.length === 0) return "missing"
  const dot = token.indexOf(".")
  if (dot <= 0) return "bad"
  const ts = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(ts)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "bad"
  const issued = Number(ts)
  if (!Number.isFinite(issued)) return "bad"
  const age = nowMs - issued
  if (age < MIN_FILL_MS) return "tooFast"
  if (age > MAX_AGE_MS) return "expired"
  return "ok"
}
