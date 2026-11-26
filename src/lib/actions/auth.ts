"use server"

import { randomBytes, createHash } from "node:crypto"
import bcrypt from "bcryptjs"
import { headers } from "next/headers"
import { prisma } from "@/lib/prisma"
import { PASSWORD_REGEX, PASSWORD_MSG } from "@/lib/passwordPolicy"
import { sendPasswordResetEmail, sendEmail } from "@/lib/email"
import { logAudit } from "@/lib/audit"
import { getChurchName } from "@/lib/emailTemplateStore"
import { escapeHtml } from "@/lib/escapeHtml"
import { logger } from "@/lib/logger"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { assertNotDemo } from "@/lib/demoMode"
import { resolveClientIp } from "@/lib/clientIp"
import { findUserByEmailInsensitive, normalizeEmail } from "@/lib/userLookup"


// Password-reset rate limit: 5 requests per 15 minutes. Keyed primarily
// by target email (always present — caps reset-email bombing of a victim and
// avoids the header-less "unknown" bucket), with a secondary per-IP DoS
// guard. Backed by a shared Postgres store so it is correct across replicas
// — see src/lib/dbRateLimit.ts.
const RESET_LIMIT = 5
const RESET_WINDOW_MS = 15 * 60_000

/**
 * Per-IP throttle key for the password-reset DoS guard: the shared rate-limit key (IPv4, or the IPv6
 * /64 prefix), or "unknown" when the request carries no valid IP, like the other limiters.
 * @returns the bucket key (never empty)
 */
async function resetRateLimitKey(): Promise<string> {
  return resolveClientIp(await headers()).key
}

// Randomized 200–500 ms delay on fast-return paths so they take roughly as
// long as the real path (SMTP send) — masks user-existence timing.
function randomDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300))
}

/**
 * Best-effort "your password was changed" notice after a completed reset (AUD-1-07). Never throws:
 * a mail failure must not fail the already-committed reset; the log carries the user id only.
 * @param userId the account owner's id (for the log line)
 * @param to the owner's email address
 */
async function notifyPasswordReset(userId: number, to: string): Promise<void> {
  try {
    const churchName = await getChurchName()
    const text = `Your password was reset using a recovery link. If this wasn't you, contact your administrator.\n${churchName}`
    const html = `<p>Your password on ${escapeHtml(churchName)} was reset using a recovery link.</p><p>If this wasn't you, contact your administrator.</p>`
    await sendEmail(to, `Your password was changed — ${churchName}`, html, text)
  } catch (err: unknown) {
    logger.error("password reset notice failed", { userId, err: err instanceof Error ? err.name : "unknown" })
  }
}

/**
 * Starts a password reset: emails a single-use reset link when the address belongs to an active user.
 * Always returns the same silent success for unknown emails, throttled senders and bad config, so it
 * cannot be used to probe which emails exist.
 * @param email the address entered on the forgot-password form
 * @returns `{ success: true }`, or `{ error }` for demo mode / invalid input
 */
export async function requestPasswordReset(
  email: string
): Promise<{ success?: true; error?: string }> {
  const demo = assertNotDemo()
  if (demo) return demo
  // Bound the input before it reaches the DB query — return the silent success
  // (no user-existence reveal) rather than an error that would leak the cap.
  if (typeof email !== "string" || email.length > 254) return { success: true }

  // Per-IP DoS guard; requests with no valid IP share the "unknown" bucket.
  const ip = await resetRateLimitKey()
  if (!(await dbRateLimit(`pwreset:ip:${ip}`, RESET_LIMIT, RESET_WINDOW_MS))) {
    return { error: "Too many requests. Please try again later." }
  }
  // The per-target-email bucket is consumed later, only for a request that is about to send mail
  // (AUD-1-09): otherwise a stranger could burn a victim's allowance with requests that send nothing.

  // Case-insensitive (legacy mixed-case rows can still reset).
  const user = await findUserByEmailInsensitive(email, {
    id: true,
    email: true,
    passwordResetExpires: true,
  })

  if (!user) {
    await randomDelay()
    return { success: true } // no user-existence reveal
  }

  if (user.passwordResetExpires && user.passwordResetExpires > new Date()) {
    await randomDelay()
    return { success: true } // silent — don't reveal token is active
  }

  const token = randomBytes(32).toString("hex")
  const tokenHash = createHash("sha256").update(token).digest("hex")
  const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  // Build the reset link off AUTH_URL. Parse it through new URL() so a
  // misconfigured/garbage AUTH_URL fails fast here instead of mailing the
  // single-use token to a malformed or attacker-controlled origin.
  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000"
  let resetUrl: string
  try {
    const u = new URL("/reset-password", baseUrl)
    u.searchParams.set("token", token)
    resetUrl = u.toString()
  } catch {
    // A bad AUTH_URL is a server misconfiguration, not a user error. Return the
    // same silent success as the other branches so this can't be used to probe
    // which emails exist, but surface the cause in the server logs.
    console.error("requestPasswordReset: invalid AUTH_URL, cannot build reset link")
    return { success: true }
  }

  // Claim the token slot BEFORE sending, conditional on no unexpired token
  //. Overlapping requests used to each pass the check above, each mail
  // a different token, then last-write-wins silently voided every earlier link.
  // Now exactly one request wins the conditional write and only it sends; the
  // loser returns the same silent success as the "token still active" branch.
  // Trade-off: a process killed mid-send (not a catchable failure) leaves the
  // claim parked until expiry, so retries no-op for up to the 1h TTL — the same
  // wait as a user whose link did arrive. Accepted over losing links to races.
  // Only real users reach this write, so a throw must not surface as a
  // distinct error — same silent success as every other branch.
  let claimed: { count: number }
  try {
    claimed = await prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ passwordResetExpires: null }, { passwordResetExpires: { lte: new Date() } }],
      },
      data: { passwordResetToken: tokenHash, passwordResetExpires: expires },
    })
  } catch {
    console.error("requestPasswordReset: failed to claim reset token slot")
    await randomDelay()
    return { success: true }
  }
  if (claimed.count === 0) {
    await randomDelay()
    return { success: true }
  }

  // Per-target-email cap on mail actually sent (see the note above). Exhausted: release the claim
  // and return the same silent success, so the cap is never visible to a prober.
  const emailKey = `pwreset:email:${createHash("sha256").update(normalizeEmail(email)).digest("hex")}`
  // A limiter failure is treated like exhaustion: release the claim (only our tokenHash) and return
  // the same silent success, so no stranded claim blocks retries for the 1h TTL.
  let emailAllowed = false
  try {
    emailAllowed = await dbRateLimit(emailKey, RESET_LIMIT, RESET_WINDOW_MS)
  } catch {
    console.error("requestPasswordReset: email rate limiter failed")
  }
  if (!emailAllowed) {
    await prisma.user
      .updateMany({
        where: { id: user.id, passwordResetToken: tokenHash },
        data: { passwordResetToken: null, passwordResetExpires: null },
      })
      .catch(() => {})
    await randomDelay()
    return { success: true }
  }

  // (accepted, LOW): unlike the fast-return "don't reveal" branches
  // above, this real-send path isn't wrapped in randomDelay() — its latency is
  // the real SMTP round-trip, a weak, noisy user-enumeration timing signal.
  // Truly closing it means sending out-of-band (fire-and-forget/queue), which
  // would forfeit the rollback-on-failure retry guarantee below. Not worth that
  // regression for a weak signal at church scale.
  // Swallow transport errors and return the same silent success as every other
  // branch: a raw 500 here would be an enumeration oracle (only real users reach
  // the send) and crash a user-facing flow. Mirrors issueWelcomeInvite.
  try {
    await sendPasswordResetEmail(user.email, resetUrl)
  } catch {
    console.error("requestPasswordReset: failed to send reset email")
    // The link never arrived — release the slot so the user can retry
    // immediately. Scoped to our own hash so it can't clear a newer token.
    await prisma.user
      .updateMany({
        where: { id: user.id, passwordResetToken: tokenHash },
        data: { passwordResetToken: null, passwordResetExpires: null },
      })
      .catch(() => {})
    return { success: true }
  }

  return { success: true }
}

/**
 * Completes a password reset from an emailed single-use link: sets the new password, ends every
 * session, drops trusted devices and passkeys, then audits it and notifies the owner.
 * @param token the raw 64-hex reset token from the link
 * @param password the new password (must satisfy PASSWORD_REGEX)
 * @returns `{ success: true }`, or `{ error }` for a weak password or an invalid/expired/used link
 */
export async function resetPassword(
  token: string,
  password: string
): Promise<{ success?: true; error?: string }> {
  const demo = assertNotDemo()
  if (demo) return demo
  if (!PASSWORD_REGEX.test(password)) return { error: PASSWORD_MSG }

  // Token is a 32-byte hex string (randomBytes(32).toString("hex")). Reject any
  // other shape before the DB lookup — same opaque message, no enumeration.
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: "Invalid or expired reset link." }

  const tokenHash = createHash("sha256").update(token).digest("hex")

  const user = await prisma.user.findUnique({
    where: { passwordResetToken: tokenHash },
    select: { id: true, email: true, passwordResetExpires: true },
  })

  if (!user?.passwordResetExpires || user.passwordResetExpires < new Date()) {
    return { error: "Invalid or expired reset link." }
  }

  const passwordHash = await bcrypt.hash(password, 12)

  // Single-use consume: require the still-present token hash AND an unexpired
  // timestamp in the update predicate so two concurrent submissions of the same
  // link can't both land — the first clears the token, the second matches 0 rows
  //. A count of 0 means the link was already used or expired between the
  // read above and here.
  const ok = await prisma.$transaction(async (tx) => {
    const consumed = await tx.user.updateMany({
      where: { id: user.id, passwordResetToken: tokenHash, passwordResetExpires: { gte: new Date() } },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        // Invalidate any in-flight OTP and OTP lockout
        otpCode: null,
        otpExpiresAt: null,
        failedOtpAttempts: 0,
        otpLockedUntil: null,
        // Kill any session/JWT minted before this reset — a stolen token must not
        // survive a password change (same mechanism logout uses).
        sessionsValidFrom: new Date(),
      },
    })
    if (consumed.count === 0) return false
    // A passkey replaces both the password and the second factor, so recovery must
    // drop them too — otherwise one planted by whoever knew the old password survives.
    // Same transaction: a failed delete rolls the reset back instead of leaving them.
    await tx.trustedDevice.deleteMany({ where: { userId: user.id } })
    await tx.passkey.deleteMany({ where: { userId: user.id } })
    return true
  })
  if (!ok) return { error: "Invalid or expired reset link." }

  // Audit + notify the owner (AUD-1-07). logAudit swallows its own DB errors.
  await logAudit(user.id, "PASSWORD_RESET_COMPLETED", "User", user.id, undefined, resolveClientIp(await headers()).ip)
  await notifyPasswordReset(user.id, user.email)

  return { success: true }
}
