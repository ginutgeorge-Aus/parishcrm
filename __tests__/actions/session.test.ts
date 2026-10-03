/** @jest-environment node */
import { auth, signOut } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn(), signOut: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn() },
    trustedDevice: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}))

import { logout } from "@/lib/actions/session"

const mockAuth = auth as unknown as jest.Mock
const mockSignOut = signOut as unknown as jest.Mock
const mockUpdate = prisma.user.update as jest.Mock
const mockFind = prisma.user.findUnique as jest.Mock
const mockDeleteMany = prisma.trustedDevice.deleteMany as jest.Mock

describe("logout", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "7", role: "ADMIN" } })
  })

  it("stamps sessionsValidFrom to invalidate outstanding tokens", async () => {
    await logout()
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ sessionsValidFrom: expect.any(Date) }),
      }),
    )
  })

  it("does not stamp sessionsValidFrom for a shared demo user, but still signs out", async () => {
    process.env.DEMO_MODE = "true"
    try {
      mockFind.mockResolvedValue({ email: "admin@demo.invalid" })
      await logout()
      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: "/login" })
    } finally {
      delete process.env.DEMO_MODE
    }
  })

  it("still stamps for a non-demo email even when DEMO_MODE is on", async () => {
    process.env.DEMO_MODE = "true"
    try {
      mockFind.mockResolvedValue({ email: "a@example.com" })
      await logout()
      expect(mockUpdate).toHaveBeenCalled()
    } finally {
      delete process.env.DEMO_MODE
    }
  })

  it("does NOT delete trusted devices — remembered devices survive logout", async () => {
    await logout()
    expect(mockDeleteMany).not.toHaveBeenCalled()
  })

  it("signs out and redirects to /login", async () => {
    await logout()
    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: "/login" })
  })

  it("still signs out when there is no active session", async () => {
    mockAuth.mockResolvedValue(null)
    await logout()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: "/login" })
  })

  it("ignores a P2025 (user since deleted) and still signs out", async () => {
    mockUpdate.mockRejectedValue({ code: "P2025" })
    await expect(logout()).resolves.toBeUndefined()
    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: "/login" })
  })

  it("rethrows a non-P2025 update failure and never reaches signOut", async () => {
    // A DB outage must NOT clear the cookie while sessionsValidFrom is unpersisted —
    // captured JWTs would otherwise stay valid until their normal expiry.
    mockUpdate.mockRejectedValue({ code: "P1001", message: "Can't reach database server" })
    await expect(logout()).rejects.toMatchObject({ code: "P1001" })
    expect(mockSignOut).not.toHaveBeenCalled()
  })
})
