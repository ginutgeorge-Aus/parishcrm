/** @jest-environment node */
import { hash } from "bcryptjs"
import { Secret, TOTP } from "otpauth"

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { updateMany: jest.fn() },
    backupCode: { findMany: jest.fn(), updateMany: jest.fn() },
  },
}))
// Identity "encryption" so the test controls the plaintext secret directly.
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => {
    if (v === "corrupt") throw new Error("bad tag")
    return v.replace(/^enc:/, "")
  }),
}))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn() } }))

import { prisma } from "@/lib/prisma"
import { verifySecondFactor } from "@/lib/totpVerify"

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
const NOW = 1_790_000_000_000
const STEP = Math.floor(NOW / 1000 / 30)
const code = new TOTP({ secret: Secret.fromBase32(SECRET), algorithm: "SHA1", digits: 6, period: 30 }).generate({ timestamp: NOW })
const user = { id: 7, totpSecret: `enc:${SECRET}` }

describe("verifySecondFactor", () => {
  beforeEach(() => jest.clearAllMocks())

  it("accepts a valid TOTP and records its step atomically", async () => {
    ;(prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await expect(verifySecondFactor(user, code, NOW)).resolves.toEqual({ ok: true, via: "totp" })
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 7, OR: [{ totpLastStep: null }, { totpLastStep: { lt: STEP } }] },
      data: { totpLastStep: STEP },
    })
  })

  it("rejects a replayed code (step not newer → zero rows)", async () => {
    ;(prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    await expect(verifySecondFactor(user, code, NOW)).resolves.toEqual({ ok: false, reason: "totp_replay" })
  })

  it("rejects a wrong TOTP without writing", async () => {
    const wrong = code === "000000" ? "111111" : "000000"
    await expect(verifySecondFactor(user, wrong, NOW)).resolves.toEqual({ ok: false, reason: "totp_invalid" })
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a TOTP when the user has no secret", async () => {
    await expect(verifySecondFactor({ id: 7, totpSecret: null }, code, NOW)).resolves.toEqual({ ok: false, reason: "totp_invalid" })
  })

  it("reports an unreadable secret instead of throwing", async () => {
    await expect(verifySecondFactor({ id: 7, totpSecret: "corrupt" }, code, NOW)).resolves.toEqual({
      ok: false,
      reason: "totp_secret_unreadable",
    })
  })

  it("reports a non-base32 secret as unreadable without writing", async () => {
    await expect(verifySecondFactor({ id: 7, totpSecret: "enc:!!!not-base32!!!" }, code, NOW)).resolves.toEqual({
      ok: false,
      reason: "totp_secret_unreadable",
    })
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it("propagates a DB error from the replay-guard write", async () => {
    ;(prisma.user.updateMany as jest.Mock).mockRejectedValue(new Error("db down"))
    await expect(verifySecondFactor(user, code, NOW)).rejects.toThrow("db down")
  })

  it("consumes a matching unused backup code once", async () => {
    const h1 = await hash("AB3CDEF4GH", 4)
    const h2 = await hash("ZZZZZ11111", 4)
    ;(prisma.backupCode.findMany as jest.Mock).mockResolvedValue([
      { id: "b1", codeHash: h1 },
      { id: "b2", codeHash: h2 },
    ])
    ;(prisma.backupCode.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await expect(verifySecondFactor(user, "ab3cd-ef4gh", NOW)).resolves.toEqual({ ok: true, via: "backup", remaining: 1 })
    expect(prisma.backupCode.findMany).toHaveBeenCalledWith({
      where: { userId: 7, usedAt: null },
      select: { id: true, codeHash: true },
    })
    expect(prisma.backupCode.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
  })

  it("rejects a backup code consumed concurrently (zero rows)", async () => {
    ;(prisma.backupCode.findMany as jest.Mock).mockResolvedValue([{ id: "b1", codeHash: await hash("AB3CDEF4GH", 4) }])
    ;(prisma.backupCode.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    await expect(verifySecondFactor(user, "AB3CD-EF4GH", NOW)).resolves.toEqual({ ok: false, reason: "backup_invalid" })
  })

  it("rejects an unknown or malformed backup code", async () => {
    ;(prisma.backupCode.findMany as jest.Mock).mockResolvedValue([{ id: "b1", codeHash: await hash("AB3CDEF4GH", 4) }])
    await expect(verifySecondFactor(user, "QQQQQ-QQQQQ", NOW)).resolves.toEqual({ ok: false, reason: "backup_invalid" })
    await expect(verifySecondFactor(user, "not-a-code!", NOW)).resolves.toEqual({ ok: false, reason: "backup_invalid" })
    expect(prisma.backupCode.updateMany).not.toHaveBeenCalled()
  })
})
