import "server-only"
import { compare } from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/crypto"
import { logger } from "@/lib/logger"
import { BACKUP_CODE_RE, TOTP_CODE_RE, matchTotpStep, normaliseBackupCode } from "@/lib/totp"

export type SecondFactorUser = { id: number; totpSecret: string | null }
export type SecondFactorFailure = "totp_invalid" | "totp_replay" | "backup_invalid" | "totp_secret_unreadable"
export type SecondFactorResult =
  | { ok: true; via: "totp" }
  | { ok: true; via: "backup"; remaining: number }
  | { ok: false; reason: SecondFactorFailure }

// One routine for "is this a valid authenticator OR backup code for this user",
// used by login and by the self-service management actions. A 6-digit input is
// treated as TOTP; anything else as a backup code. Lockout counting is the
// caller's job (login vs. management actions count differently).
export async function verifySecondFactor(
  user: SecondFactorUser,
  input: string,
  now: number = Date.now(),
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
    // concurrent requests with the same code → exactly one succeeds. DB errors
    // propagate (not an unreadable secret).
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
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
      const { count } = await prisma.backupCode.updateMany({
        where: { id: c.id, usedAt: null },
        data: { usedAt: new Date() },
      })
      if (count !== 1) return { ok: false, reason: "backup_invalid" }
      return { ok: true, via: "backup", remaining: codes.length - 1 }
    }
  }
  return { ok: false, reason: "backup_invalid" }
}
