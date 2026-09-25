"use server"

import { randomBytes, createHash } from "crypto"
import bcrypt from "bcryptjs"
import { headers } from "next/headers"
import { prisma } from "@/lib/prisma"
import { sendPasswordResetEmail } from "@/lib/email"
import { dbRateLimit } from "@/lib/dbRateLimit"

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/
const PASSWORD_MSG =
  "Password must be at least 8 characters and include uppercase, lowercase, number, and special character"

// Password-reset rate limit: 5 requests per 15 minutes. Keyed primarily
// by target email (always present — caps reset-email bombing of a victim and
// avoids the header-less "unknown" bucket), with a secondary per-IP DoS
// guard. Backed by a shared Postgres store so it is correct across replicas
// — see src/lib/dbRateLimit.ts.
const RESET_LIMIT = 5
const RESET_WINDOW_MS = 15 * 60_000

async function getClientIp(): Promise<string | null> {
  const xff = (await headers()).get("x-forwarded-for")
  if (xff) {
    // Rightmost IP is appended by the trusted reverse proxy — not spoofable by client
    const last = xff.split(",").at(-1)?.trim()
    if (last) return last
  }
  return null
}

// Randomized 200–500 ms delay on fast-return paths so they take roughly as
// long as the real path (SMTP send) — masks user-existence timing.
function randomDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300))
}

export async function requestPasswordReset(
  email: string
): Promise<{ success?: true; error?: string }> {
  // Bound the input before it reaches the DB query — return the silent success
  // (no user-existence reveal) rather than an error that would leak the cap.
  if (typeof email !== "string" || email.length > 254) return { success: true }

  // Primary: per-target-email limit (always present).
  const emailKey = `pwreset:email:${createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")}`
  if (!(await dbRateLimit(emailKey, RESET_LIMIT, RESET_WINDOW_MS))) {
    return { error: "Too many requests. Please try again later." }
  }
  // Secondary: per-IP DoS guard, only when a real client IP is available.
  const ip = await getClientIp()
  if (ip && !(await dbRateLimit(`pwreset:ip:${ip}`, RESET_LIMIT, RESET_WINDOW_MS))) {
    return { error: "Too many requests. Please try again later." }
  }

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, passwordResetExpires: true },
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
  const claimed = await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [{ passwordResetExpires: null }, { passwordResetExpires: { lte: new Date() } }],
    },
    data: { passwordResetToken: tokenHash, passwordResetExpires: expires },
  })
  if (claimed.count === 0) {
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

export async function resetPassword(
  token: string,
  password: string
): Promise<{ success?: true; error?: string }> {
  if (!PASSWORD_REGEX.test(password)) return { error: PASSWORD_MSG }

  // Token is a 32-byte hex string (randomBytes(32).toString("hex")). Reject any
  // other shape before the DB lookup — same opaque message, no enumeration.
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: "Invalid or expired reset link." }

  const tokenHash = createHash("sha256").update(token).digest("hex")

  const user = await prisma.user.findUnique({
    where: { passwordResetToken: tokenHash },
    select: { id: true, passwordResetExpires: true },
  })

  if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
    return { error: "Invalid or expired reset link." }
  }

  const passwordHash = await bcrypt.hash(password, 12)

  // Single-use consume: require the still-present token hash AND an unexpired
  // timestamp in the update predicate so two concurrent submissions of the same
  // link can't both land — the first clears the token, the second matches 0 rows
  //. A count of 0 means the link was already used or expired between the
  // read above and here.
  const consumed = await prisma.user.updateMany({
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
  if (consumed.count === 0) return { error: "Invalid or expired reset link." }

  await prisma.trustedDevice.deleteMany({ where: { userId: user.id } })

  return { success: true }
}
