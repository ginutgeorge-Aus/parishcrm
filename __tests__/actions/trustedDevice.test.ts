/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { trustedDevice: { create: jest.fn().mockResolvedValue({ id: "d1" }), updateMany: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() } },
}))
const cookieSet = jest.fn()
jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({ set: cookieSet })),
  headers: jest.fn(async () => ({ get: (k: string) => (k === "user-agent" ? "TestUA/1.0" : null) })),
}))
jest.mock("@/lib/trustedDevice", () => ({
  TRUSTED_DEVICE_COOKIE: "trusted_device",
  DEVICE_TRUST_GRANT_PREFIX: "grant:",
  TRUSTED_DEVICE_TTL_MS: 14 * 24 * 60 * 60 * 1000,
  generateDeviceToken: jest.fn(() => "RAWTOKEN"),
  hashDeviceToken: jest.fn((t: string) => `hash:${t}`),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { trustDevice, revokeTrustedDevice, listTrustedDevices } from "@/lib/actions/trustedDevice"

describe("trustDevice", () => {
  beforeEach(() => jest.clearAllMocks())

  it("rejects when unauthenticated", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    const r = await trustDevice()
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.trustedDevice.create).not.toHaveBeenCalled()
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it("exchanges a fresh grant for a hashed device token and sets the cookie", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "7", role: "VIEWER" }, deviceTrustGrant: "d1" })
    ;(prisma.trustedDevice.updateMany as jest.Mock).mockResolvedValue({ count: 1 })

    const r = await trustDevice()
    expect(r).toEqual({ success: true })

    const createArg = (prisma.trustedDevice.updateMany as jest.Mock).mock.calls[0][0]
    expect(createArg.where).toEqual({ id: "d1", userId: 7, tokenHash: { startsWith: "grant:" }, expiresAt: { gt: expect.any(Date) } })
    expect(createArg.data.tokenHash).toBe("hash:RAWTOKEN")
    expect(createArg.data.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const [name, value, opts] = cookieSet.mock.calls[0]
    expect(name).toBe("trusted_device")
    expect(value).toBe("RAWTOKEN")
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" })

    // granting a 14-day OTP-bypass is a security-boundary action → audit.
    expect(logAudit).toHaveBeenCalledWith(7, "TRUSTED_DEVICE_GRANTED", "TrustedDevice", undefined, { deviceId: "d1" })
  })
})

describe("revokeTrustedDevice", () => {
  beforeEach(() => jest.clearAllMocks())

  it("deletes only a row owned by the current user", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "7", role: "VIEWER" } })
    ;(prisma.trustedDevice.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })
    const r = await revokeTrustedDevice("d1")
    expect(r).toEqual({ success: true })
    expect(prisma.trustedDevice.deleteMany).toHaveBeenCalledWith({ where: { id: "d1", userId: 7 } })
    expect(logAudit).toHaveBeenCalledWith(7, "TRUSTED_DEVICE_REVOKED", "TrustedDevice", undefined, { deviceId: "d1" })
  })

  it("rejects when unauthenticated", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    expect(await revokeTrustedDevice("d1")).toEqual({ error: "Unauthorized" })
  })
})


describe("device trust requires a single-use OTP grant", () => {
  beforeEach(() => jest.clearAllMocks())

  it("rejects an existing session without OTP proof", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "7" } })
    expect(await trustDevice()).toEqual({ error: "Unauthorized" })
    expect(prisma.trustedDevice.create).not.toHaveBeenCalled()
    expect(prisma.trustedDevice.updateMany).not.toHaveBeenCalled()
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it.each(["0", "-1", "7junk", "2147483648"])("rejects invalid user ID %s", async (id) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id }, deviceTrustGrant: "d1" })
    expect(await trustDevice()).toEqual({ error: "Unauthorized" })
    expect(prisma.trustedDevice.updateMany).not.toHaveBeenCalled()
  })

  it.each(["expired", "other-user", "consumed"])("rejects a %s grant without writing a cookie", async (state) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "7" }, deviceTrustGrant: "d1" })
    const row = { id: "d1", userId: state === "other-user" ? 8 : 7, tokenHash: state === "consumed" ? "hash:old" : "grant:proof", expiresAt: new Date(Date.now() + (state === "expired" ? -1000 : 300000)) }
    ;(prisma.trustedDevice.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
      if (where.id !== row.id || where.userId !== row.userId || !row.tokenHash.startsWith(where.tokenHash.startsWith) || row.expiresAt <= where.expiresAt.gt) return { count: 0 }
      Object.assign(row, data)
      return { count: 1 }
    })
    expect(await trustDevice()).toEqual({ error: "Unauthorized" })
    expect(cookieSet).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("allows only one concurrent exchange and rejects later replay", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "7" }, deviceTrustGrant: "d1" })
    let tokenHash = "grant:proof"
    ;(prisma.trustedDevice.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
      if (!tokenHash.startsWith(where.tokenHash.startsWith)) return { count: 0 }
      tokenHash = data.tokenHash
      return { count: 1 }
    })
    const results = await Promise.all([trustDevice(), trustDevice()])
    expect(results).toEqual(expect.arrayContaining([{ success: true }, { error: "Unauthorized" }]))
    expect(await trustDevice()).toEqual({ error: "Unauthorized" })
    expect(cookieSet).toHaveBeenCalledTimes(1)
    expect(logAudit).toHaveBeenCalledTimes(1)
  })

  it("does not list pending grants as trusted devices", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "7" } })
    ;(prisma.trustedDevice.findMany as jest.Mock).mockResolvedValue([])
    expect(await listTrustedDevices()).toEqual([])
    expect(prisma.trustedDevice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 7, NOT: { tokenHash: { startsWith: "grant:" } } } }))
  })
})
