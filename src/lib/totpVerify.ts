import "server-only"
import { compare } from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/crypto"
import { logger } from "@/lib/logger"
import { BACKUP_CODE_RE, TOTP_CODE_RE, matchTotpStep, normaliseBackupCode } from "@/lib/totp"

export type SecondFactorUser = { id: number; totpSecret: string | null }
type SecondFactorFailure = "totp_invalid" | "totp_replay" | "backup_invalid" | "totp_secret_unreadable"
export type SecondFactorResult =
  | { ok: true; via: "totp" }
  | { ok: true; via: "backup"; remaining: number }
  | { ok: false; reason: SecondFactorFailure }

// One routine for "is this a valid authenticator OR backup code for this user",
// used by login and by the self-service management actions. A 6-digit input is
// treated as TOTP; anything else as a backup code. Lockout counting is the
// caller's job (login vs. management actions count differently), but login can
// pass `resetLockouts` to clear the password/OTP counters in the same write that
// records the step or consumes the backup code.
const LOCKOUT_RESET = { failedLoginAttempts: 0, lockedUntil: null, failedOtpAttempts: 0, otpLockedUntil: null }

class BackupCodeTaken extends Error {}

export async function verifySecondFactor(
  user: SecondFactorUser,
  input: string,
  { now = Date.now(), resetLockouts = false }: { now?: number; resetLockouts?: boolean } = {},
): Promise<SecondFactorResult> {
  const trimmed = input.trim()

  if (TOTP_CODE_RE.test(trimmed)) {
    if (!user.totpSecret) return { ok: false, reason: "totp_invalid" }
    let step: number | null
    try {
      step = matchTotpStep(decrypt(user.totpSecret), trimmed, now)
    } catch (err: unknown) {
      logger.error("totp secret unreadable", { userId: user.id, err: err instanceof Error ? err.message : String(err) })
      return { ok: false, reason: "totp_secret_unreadable" }
    }
    if (step === null) return { ok: false, reason: "totp_invalid" }
    // Atomic replay guard: only a strictly newer step wins the row. Two
    // concurrent requests with the same code → exactly one succeeds. Bound to
    // the secret we verified against, so a reset/re-enrol mid-request (which
    // nulls totpLastStep) can't let the old authenticator through. DB errors
    // propagate (not an unreadable secret).
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, totpSecret: user.totpSecret, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step, ...(resetLockouts ? LOCKOUT_RESET : {}) },
    })
    return count === 1 ? { ok: true, via: "totp" } : { ok: false, reason: "totp_replay" }
  }

  const normalised = normaliseBackupCode(trimmed)
  if (!BACKUP_CODE_RE.test(normalised)) return { ok: false, reason: "backup_invalid" }
  const codes = await prisma.backupCode.findMany({
    where: { userId: user.id, usedAt: null },
    select: { id: true, codeHash: true },
  })
  for (const c of codes) {
    if (await compare(normalised, c.codeHash)) {
      try {
        await prisma.$transaction(async (tx) => {
          // User row before BackupCode — same lock order as the totp actions
          // (disable/regenerate), so they can't deadlock. A lost consume race
          // throws to roll the counter reset back.
          if (resetLockouts) await tx.user.update({ where: { id: user.id }, data: LOCKOUT_RESET })
          const { count } = await tx.backupCode.updateMany({
            where: { id: c.id, usedAt: null },
            data: { usedAt: new Date() },
          })
          if (count !== 1) throw new BackupCodeTaken()
        })
      } catch (err: unknown) {
        if (err instanceof BackupCodeTaken) return { ok: false, reason: "backup_invalid" }
        throw err
      }
      return { ok: true, via: "backup", remaining: codes.length - 1 }
    }
  }
  return { ok: false, reason: "backup_invalid" }
}
