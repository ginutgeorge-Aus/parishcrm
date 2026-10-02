"use server"

import { revalidatePath } from "next/cache"
import { compare, hash } from "bcryptjs"
import QRCode from "qrcode"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { encrypt, decrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { getChurchSettings } from "@/lib/churchSettings"
import { actorId } from "@/lib/actor"
import { sendEmail } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { logger } from "@/lib/logger"
import {
  TOTP_CLEARED, TOTP_CODE_RE, generateBackupCodes, generateTotpSecret, matchTotpStep, normaliseBackupCode, totpKeyUri,
} from "@/lib/totp"
import { verifySecondFactor } from "@/lib/totpVerify"
import { assertNotDemo } from "@/lib/demoMode"

export type TotpStatus = { enabled: boolean; backupCodesRemaining: number }

const UNAUTHORIZED = { error: "Unauthorized" } as const
const RATE_LIMITED = { error: "Too many attempts. Try again in 15 minutes." } as const

// Every action acts on the session user only — no userId argument, so there is
// no IDOR surface. Admin reset of someone else lives in user.ts::resetUserTotp.
async function sessionUserId(): Promise<number | null> {
  const session = await auth()
  try {
    return actorId(session)
  } catch {
    return null
  }
}

// Security notice after the authenticator is turned on/off. Best-effort: a mail
// failure must never fail the (already committed) action, and the log carries
// the user id only — never the address.
async function notifyTotpChange(userId: number, to: string | null | undefined, on: boolean): Promise<void> {
  if (!to) return
  try {
    const churchName = await getChurchName()
    const state = on ? "on" : "off"
    const text = `An authenticator app was turned ${state} for your account. If this wasn't you, contact your administrator.`
    const html = `<p>An authenticator app was turned <strong>${state}</strong> for your account on ${escapeHtml(churchName)}.</p><p>If this wasn't you, contact your administrator.</p>`
    await sendEmail(to, `Authenticator app turned ${state} — ${churchName}`, html, `${text}\n${churchName}`)
  } catch (err: unknown) {
    logger.error("totp change notice failed", { userId, err: err instanceof Error ? err.name : "unknown" })
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const REPLAY = { error: "That code was already used — wait for the next code" } as const

// Counts every code-checking call (success or not): 5 per 15 min is ample for a
// human and caps online guessing of the 6-digit space from a stolen session.
function codeAttemptAllowed(userId: number): Promise<boolean> {
  return dbRateLimit(`totp:manage:${userId}`, 5, 15 * 60_000)
}

// Hash BEFORE opening the transaction: 10 bcrypt rounds would otherwise hold
// the interactive tx (and its connection) open for ~1s.
function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => hash(normaliseBackupCode(c), 10)))
}

async function replaceBackupCodes(userId: number, tx: Pick<typeof prisma, "backupCode">, hashes: string[]) {
  await tx.backupCode.deleteMany({ where: { userId } })
  await tx.backupCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) })
}

export async function getTotpStatus(): Promise<TotpStatus> {
  const userId = await sessionUserId()
  if (!userId) return { enabled: false, backupCodesRemaining: 0 }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      totpEnabledAt: true,
      _count: { select: { backupCodes: { where: { usedAt: null } } } },
    },
  })
  return {
    enabled: !!user?.totpEnabledAt,
    backupCodesRemaining: user?.totpEnabledAt ? (user._count?.backupCodes ?? 0) : 0,
  }
}

export async function startTotpEnrolment(): Promise<
  { error: string } | { success: true; qrDataUrl: string; manualKey: string }
> {
  const demo = assertNotDemo()
  if (demo) return demo
  const userId = await sessionUserId()
  if (!userId) return UNAUTHORIZED
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, totpEnabledAt: true, archivedAt: true },
  })
  if (!user || user.archivedAt) return UNAUTHORIZED
  if (user.totpEnabledAt) return { error: "Authenticator is already enabled" }

  const secret = generateTotpSecret()
  await prisma.user.update({ where: { id: userId }, data: { totpPendingSecret: encrypt(secret) } })
  const { name } = await getChurchSettings()
  const qrDataUrl = await QRCode.toDataURL(totpKeyUri(secret, user.email, name || "ParishCRM"))
  return { success: true, qrDataUrl, manualKey: secret }
}

export async function confirmTotpEnrolment(
  code: string,
  password: string,
): Promise<{ error: string } | { success: true; backupCodes: string[] }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const userId = await sessionUserId()
  if (!userId) return UNAUTHORIZED
  if (!(await codeAttemptAllowed(userId))) return RATE_LIMITED
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true, totpEnabledAt: true, totpPendingSecret: true },
  })
  if (!user) return UNAUTHORIZED
  // Re-auth: a hijacked session alone must not be able to bind an attacker's
  // authenticator. Rate-limited above, so this can't be used to guess the password.
  if (typeof password !== "string" || !password || !(await compare(password, user.passwordHash))) {
    return { error: "Incorrect password" }
  }
  if (user.totpEnabledAt) return { error: "Authenticator is already enabled" }
  if (!user.totpPendingSecret) return { error: "Setup expired — start again" }

  // decrypt AND matchTotpStep can throw on a corrupt pending secret.
  let step: number | null
  try {
    step = matchTotpStep(decrypt(user.totpPendingSecret), typeof code === "string" ? code.trim() : "")
  } catch {
    return { error: "Setup expired — start again" }
  }
  if (step === null) return { error: "That code didn't match. Try the current code." }

  const pending = user.totpPendingSecret
  const backupCodes = generateBackupCodes()
  const hashes = await hashBackupCodes(backupCodes)
  const enabled = await prisma.$transaction(async (tx) => {
    // Conditioned on the exact pending ciphertext just verified: a concurrent
    // restart (new pending secret) or double-submit can't enable the wrong one.
    const { count } = await tx.user.updateMany({
      where: { id: userId, totpEnabledAt: null, totpPendingSecret: pending },
      data: { totpSecret: pending, totpPendingSecret: null, totpEnabledAt: new Date(), totpLastStep: step },
    })
    if (count !== 1) return false
    await replaceBackupCodes(userId, tx, hashes)
    return true
  })
  if (!enabled) return { error: "Setup expired — start again" }

  await logAudit(userId, "TOTP_ENABLED", "User", userId)
  await notifyTotpChange(userId, user.email, true)
  revalidatePath("/account")
  return { success: true, backupCodes }
}

export async function cancelTotpEnrolment(): Promise<{ error: string } | { success: true }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const userId = await sessionUserId()
  if (!userId) return UNAUTHORIZED
  await prisma.user.update({ where: { id: userId }, data: { totpPendingSecret: null } })
  return { success: true }
}

async function enrolledUser(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, totpSecret: true, totpEnabledAt: true },
  })
}

export async function regenerateBackupCodes(
  code: string,
): Promise<{ error: string } | { success: true; backupCodes: string[] }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const userId = await sessionUserId()
  if (!userId) return UNAUTHORIZED
  if (!(await codeAttemptAllowed(userId))) return RATE_LIMITED
  const user = await enrolledUser(userId)
  if (!user?.totpEnabledAt) return { error: "Authenticator is not enabled" }
  // Regeneration proves possession of the device, not of an old backup code.
  const trimmed = typeof code === "string" ? code.trim() : ""
  if (!TOTP_CODE_RE.test(trimmed)) return { error: "Enter a code from your authenticator app" }
  const result = await verifySecondFactor(user, trimmed)
  if (!result.ok) return result.reason === "totp_replay" ? REPLAY : { error: "Invalid code" }

  const backupCodes = generateBackupCodes()
  const hashes = await hashBackupCodes(backupCodes)
  const replaced = await prisma.$transaction(async (tx) => {
    // Disabled/reset/re-enrolled since the check above → don't leave orphan
    // codes. A no-op conditional write (not a count) row-locks the enrolment
    // we verified until commit, so a concurrent disable can't interleave.
    const { count } = await tx.user.updateMany({
      where: { id: userId, totpSecret: user.totpSecret, totpEnabledAt: { not: null } },
      data: { totpEnabledAt: user.totpEnabledAt },
    })
    if (count !== 1) return false
    await replaceBackupCodes(userId, tx, hashes)
    return true
  })
  if (!replaced) return { error: "Authenticator is not enabled" }
  await logAudit(userId, "BACKUP_CODES_REGENERATED", "User", userId)
  revalidatePath("/account")
  return { success: true, backupCodes }
}

export async function disableTotp(code: string): Promise<{ error: string } | { success: true }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const userId = await sessionUserId()
  if (!userId) return UNAUTHORIZED
  if (!(await codeAttemptAllowed(userId))) return RATE_LIMITED
  const user = await enrolledUser(userId)
  if (!user?.totpEnabledAt) return { error: "Authenticator is not enabled" }
  const result = await verifySecondFactor(user, typeof code === "string" ? code : "")
  if (!result.ok) return result.reason === "totp_replay" ? REPLAY : { error: "Invalid code" }

  // Bound to the verified enrolment: a stale request must not wipe a newer one.
  const disabled = await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: userId, totpSecret: user.totpSecret, totpEnabledAt: { not: null } },
      data: TOTP_CLEARED,
    })
    if (count !== 1) return false
    await tx.backupCode.deleteMany({ where: { userId } })
    return true
  })
  if (!disabled) return { error: "Authenticator is not enabled" }
  await logAudit(userId, "TOTP_DISABLED", "User", userId, { via: result.via })
  await notifyTotpChange(userId, user.email, false)
  revalidatePath("/account")
  return { success: true }
}
