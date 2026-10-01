"use server"

import { revalidatePath } from "next/cache"
import { hash } from "bcryptjs"
import QRCode from "qrcode"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { encrypt, decrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { getChurchSettings } from "@/lib/churchSettings"
import { isValidPgId } from "@/lib/validation"
import {
  TOTP_CODE_RE, generateBackupCodes, generateTotpSecret, matchTotpStep, normaliseBackupCode, totpKeyUri,
} from "@/lib/totp"
import { verifySecondFactor } from "@/lib/totpVerify"

export type TotpStatus = { enabled: boolean; pending: boolean; backupCodesRemaining: number }

const UNAUTHORIZED = { error: "Unauthorized" } as const
const RATE_LIMITED = { error: "Too many attempts. Try again in 15 minutes." } as const

// Every action acts on the session user only — no userId argument, so there is
// no IDOR surface. Admin reset of someone else lives in user.ts::resetUserTotp.
async function sessionUserId(): Promise<number | null> {
  const session = await auth()
  const id = Number(session?.user?.id)
  return isValidPgId(id) ? id : null
}

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
  if (!userId) return { enabled: false, pending: false, backupCodesRemaining: 0 }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabledAt: true, totpPendingSecret: true },
  })
  const backupCodesRemaining = user?.totpEnabledAt
    ? await prisma.backupCode.count({ where: { userId, usedAt: null } })
    : 0
  return { enabled: !!user?.totpEnabledAt, pending: !!user?.totpPendingSecret, backupCodesRemaining }
}

export async function startTotpEnrolment(): Promise<
  { error: string } | { success: true; qrDataUrl: string; manualKey: string }
> {
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
): Promise<{ error: string } | { success: true; backupCodes: string[] }> {
  const userId = await sessionUserId()
  if (!userId) return UNAUTHORIZED
  if (!(await codeAttemptAllowed(userId))) return RATE_LIMITED
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabledAt: true, totpPendingSecret: true },
  })
  if (!user) return UNAUTHORIZED
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
  revalidatePath("/account")
  return { success: true, backupCodes }
}

export async function cancelTotpEnrolment(): Promise<{ error: string } | { success: true }> {
  const userId = await sessionUserId()
  if (!userId) return UNAUTHORIZED
  await prisma.user.update({ where: { id: userId }, data: { totpPendingSecret: null } })
  return { success: true }
}

async function enrolledUser(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, totpSecret: true, totpEnabledAt: true },
  })
}

export async function regenerateBackupCodes(
  code: string,
): Promise<{ error: string } | { success: true; backupCodes: string[] }> {
  const userId = await sessionUserId()
  if (!userId) return UNAUTHORIZED
  if (!(await codeAttemptAllowed(userId))) return RATE_LIMITED
  const user = await enrolledUser(userId)
  if (!user?.totpEnabledAt) return { error: "Authenticator is not enabled" }
  // Regeneration proves possession of the device, not of an old backup code.
  const trimmed = typeof code === "string" ? code.trim() : ""
  if (!TOTP_CODE_RE.test(trimmed)) return { error: "Enter a code from your authenticator app" }
  const result = await verifySecondFactor(user, trimmed)
  if (!result.ok) return { error: "Invalid code" }

  const backupCodes = generateBackupCodes()
  const hashes = await hashBackupCodes(backupCodes)
  await prisma.$transaction(async (tx) => replaceBackupCodes(userId, tx, hashes))
  await logAudit(userId, "BACKUP_CODES_REGENERATED", "User", userId)
  revalidatePath("/account")
  return { success: true, backupCodes }
}

export async function disableTotp(code: string): Promise<{ error: string } | { success: true }> {
  const userId = await sessionUserId()
  if (!userId) return UNAUTHORIZED
  if (!(await codeAttemptAllowed(userId))) return RATE_LIMITED
  const user = await enrolledUser(userId)
  if (!user?.totpEnabledAt) return { error: "Authenticator is not enabled" }
  const result = await verifySecondFactor(user, typeof code === "string" ? code : "")
  if (!result.ok) return { error: "Invalid code" }

  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({
      where: { id: userId, totpEnabledAt: { not: null } },
      data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null },
    })
    await tx.backupCode.deleteMany({ where: { userId } })
  })
  await logAudit(userId, "TOTP_DISABLED", "User", userId, { via: result.via })
  revalidatePath("/account")
  return { success: true }
}
