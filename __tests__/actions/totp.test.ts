/** @jest-environment node */
import { Secret, TOTP } from "otpauth"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    backupCode: { count: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/totpVerify", () => ({ verifySecondFactor: jest.fn() }))
jest.mock("@/lib/dbRateLimit", () => ({ dbRateLimit: jest.fn().mockResolvedValue(true) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn().mockResolvedValue({ name: "Demo Church" }) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("bcryptjs", () => ({ hash: jest.fn(async (v: string) => `bcrypt:${v}`) }))

import { auth } from "@/auth"
import { decrypt } from "@/lib/crypto"
import { prisma } from "@/lib/prisma"
import { verifySecondFactor } from "@/lib/totpVerify"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { logAudit } from "@/lib/audit"
import {
  getTotpStatus, startTotpEnrolment, confirmTotpEnrolment, cancelTotpEnrolment, regenerateBackupCodes, disableTotp,
} from "@/lib/actions/totp"

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
const liveCode = () => new TOTP({ secret: Secret.fromBase32(SECRET), algorithm: "SHA1", digits: 6, period: 30 }).generate()
const session = { user: { id: "7", role: "VIEWER" } }

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue(session)
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma))
})

describe("auth guard", () => {
  it.each([
    ["startTotpEnrolment", () => startTotpEnrolment()],
    ["confirmTotpEnrolment", () => confirmTotpEnrolment("123456")],
    ["cancelTotpEnrolment", () => cancelTotpEnrolment()],
    ["regenerateBackupCodes", () => regenerateBackupCodes("123456")],
    ["disableTotp", () => disableTotp("123456")],
  ])("%s rejects no session", async (_n, call) => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    await expect(call()).resolves.toEqual({ error: "Unauthorized" })
  })
})

describe("getTotpStatus", () => {
  it("reports enabled + remaining codes", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ totpEnabledAt: new Date(), totpPendingSecret: null })
    ;(prisma.backupCode.count as jest.Mock).mockResolvedValue(8)
    await expect(getTotpStatus()).resolves.toEqual({ enabled: true, pending: false, backupCodesRemaining: 8 })
  })
})

describe("startTotpEnrolment", () => {
  it("stores an encrypted pending secret and returns QR + key", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "admin@example.com", totpEnabledAt: null, archivedAt: null })
    const res = await startTotpEnrolment()
    expect(res).toMatchObject({ success: true, qrDataUrl: expect.stringMatching(/^data:image\/png;base64,/) })
    const key = (res as { manualKey: string }).manualKey
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { totpPendingSecret: `enc:${key}` } })
  })

  it("refuses when already enabled", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "a@example.com", totpEnabledAt: new Date(), archivedAt: null })
    await expect(startTotpEnrolment()).resolves.toEqual({ error: "Authenticator is already enabled" })
  })
})

describe("confirmTotpEnrolment", () => {
  const pendingUser = { totpEnabledAt: null, totpPendingSecret: `enc:${SECRET}` }

  it("enables TOTP, stores hashed backup codes, returns plaintext once", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(pendingUser)
    ;(prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    const res = await confirmTotpEnrolment(liveCode())
    expect(res).toMatchObject({ success: true })
    const codes = (res as { backupCodes: string[] }).backupCodes
    expect(codes).toHaveLength(10)
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 7, totpEnabledAt: null, totpPendingSecret: `enc:${SECRET}` },
      data: expect.objectContaining({ totpSecret: `enc:${SECRET}`, totpPendingSecret: null, totpEnabledAt: expect.any(Date) }),
    })
    expect(prisma.backupCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } })
    const created = (prisma.backupCode.createMany as jest.Mock).mock.calls[0][0].data
    expect(created[0].codeHash).toBe(`bcrypt:${codes[0].replace("-", "")}`)
    expect(logAudit).toHaveBeenCalledWith(7, "TOTP_ENABLED", "User", 7)
  })

  it("rejects a wrong code without enabling", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(pendingUser)
    await expect(confirmTotpEnrolment("000000")).resolves.toEqual({ error: "That code didn't match. Try the current code." })
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it("asks to restart when no pending secret", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ totpEnabledAt: null, totpPendingSecret: null })
    await expect(confirmTotpEnrolment("123456")).resolves.toEqual({ error: "Setup expired — start again" })
  })

  it("asks to restart when the pending secret is corrupt (non-base32)", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(pendingUser)
    ;(decrypt as jest.Mock).mockReturnValueOnce("not-base32-!!!")
    await expect(confirmTotpEnrolment("123456")).resolves.toEqual({ error: "Setup expired — start again" })
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it("is rate-limited", async () => {
    ;(dbRateLimit as jest.Mock).mockResolvedValueOnce(false)
    await expect(confirmTotpEnrolment("123456")).resolves.toEqual({ error: "Too many attempts. Try again in 15 minutes." })
    expect(dbRateLimit).toHaveBeenCalledWith("totp:manage:7", 5, 15 * 60_000)
  })
})

describe("cancelTotpEnrolment", () => {
  it("clears the pending secret", async () => {
    await expect(cancelTotpEnrolment()).resolves.toEqual({ success: true })
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { totpPendingSecret: null } })
  })
})

describe("regenerateBackupCodes", () => {
  const enrolled = { id: 7, totpSecret: `enc:${SECRET}`, totpEnabledAt: new Date() }

  it("requires an authenticator (not backup) code", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(enrolled)
    await expect(regenerateBackupCodes("AB3CD-EF4GH")).resolves.toEqual({ error: "Enter a code from your authenticator app" })
    expect(verifySecondFactor).not.toHaveBeenCalled()
  })

  it("replaces codes on a valid TOTP", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(enrolled)
    ;(verifySecondFactor as jest.Mock).mockResolvedValue({ ok: true, via: "totp" })
    const res = await regenerateBackupCodes("123456")
    expect((res as { backupCodes: string[] }).backupCodes).toHaveLength(10)
    expect(prisma.backupCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } })
    expect(logAudit).toHaveBeenCalledWith(7, "BACKUP_CODES_REGENERATED", "User", 7)
  })

  it("rejects an invalid code", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(enrolled)
    ;(verifySecondFactor as jest.Mock).mockResolvedValue({ ok: false, reason: "totp_invalid" })
    await expect(regenerateBackupCodes("123456")).resolves.toEqual({ error: "Invalid code" })
    expect(prisma.backupCode.deleteMany).not.toHaveBeenCalled()
  })
})

describe("disableTotp", () => {
  const enrolled = { id: 7, totpSecret: `enc:${SECRET}`, totpEnabledAt: new Date() }

  it.each([["totp"], ["backup"]])("disables with a valid %s code", async (via) => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(enrolled)
    ;(verifySecondFactor as jest.Mock).mockResolvedValue({ ok: true, via, remaining: 3 })
    await expect(disableTotp("123456")).resolves.toEqual({ success: true })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null },
    })
    expect(prisma.backupCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } })
    expect(logAudit).toHaveBeenCalledWith(7, "TOTP_DISABLED", "User", 7, { via })
  })

  it("rejects an invalid code", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(enrolled)
    ;(verifySecondFactor as jest.Mock).mockResolvedValue({ ok: false, reason: "backup_invalid" })
    await expect(disableTotp("123456")).resolves.toEqual({ error: "Invalid code" })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("errors when not enabled", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...enrolled, totpEnabledAt: null })
    await expect(disableTotp("123456")).resolves.toEqual({ error: "Authenticator is not enabled" })
  })
})
