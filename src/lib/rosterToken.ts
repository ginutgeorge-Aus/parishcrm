/**
 * Stateless, expiring, HMAC-signed token for one-tap roster confirm/decline
 * links (#625, part of #306). Pure: the secret and clock are passed in, so the
 * caller (route/email, out of scope here) decides where they come from.
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256 of the first part)>`.
 * The payload is purpose-tagged (`p: "roster:v1"`) so tokens from other HMAC
 * helpers cannot be replayed here, and carries the action so a confirm link
 * cannot be turned into a decline link.
 */
import { createHmac, timingSafeEqual } from "node:crypto"

const PURPOSE = "roster:v1"
const MAX_TOKEN_LENGTH = 512

export type RosterAction = "confirm" | "decline"

export interface RosterTokenPayload {
  assignmentId: string
  action: RosterAction
  /** Expiry, epoch milliseconds. */
  expiresAt: number
}

/**
 * HMAC-SHA256 of `data` with `secret`, base64url. Throws on an empty secret so
 * a misconfigured env can never sign with an empty (forgeable) key.
 */
function sign(data: string, secret: string): string {
  if (!secret) throw new Error("A secret is required to sign roster tokens")
  return createHmac("sha256", secret).update(data).digest("base64url")
}

/**
 * Issue a signed token for one roster assignment + action, valid until
 * `nowMs + ttlMs`. Pass `Date.now()` for `nowMs`.
 */
export function issueRosterToken(
  assignmentId: string,
  action: RosterAction,
  secret: string,
  nowMs: number,
  ttlMs: number,
): string {
  const body = Buffer.from(
    JSON.stringify({ p: PURPOSE, a: assignmentId, c: action, e: nowMs + ttlMs }),
  ).toString("base64url")
  return `${body}.${sign(body, secret)}`
}

/**
 * Verify a token from `issueRosterToken`. Returns the payload, or null for
 * anything not genuine and current: wrong type/length, malformed, bad
 * signature (constant-time compare), wrong secret, wrong purpose, or expired.
 * The signature is checked before the payload is parsed.
 */
export function verifyRosterToken(
  token: unknown,
  secret: string,
  nowMs: number,
): RosterTokenPayload | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null
  if (!secret) return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [body, sig] = parts
  const a = Buffer.from(sig)
  const b = Buffer.from(sign(body, secret))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (typeof raw !== "object" || raw === null) return null
  const { p, a: assignmentId, c, e } = raw as Record<string, unknown>
  if (p !== PURPOSE) return null
  if (typeof assignmentId !== "string" || assignmentId.length === 0) return null
  if (c !== "confirm" && c !== "decline") return null
  if (typeof e !== "number" || !Number.isFinite(e) || nowMs >= e) return null
  return { assignmentId, action: c, expiresAt: e }
}
