import { setVolunteerView, regenerateVolunteerToken } from "@/lib/actions/eventAccess"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
// event.ts now imports Prisma as a VALUE (for Prisma.JsonNull) — the real
// generated client bootstraps the query engine at module load and crashes
// under jsdom (no TextEncoder). Same mock shape as
// eventRegistration.validate.test.ts's jest.mock for this module.
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { JsonNull: "JsonNull" },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const asRole = (role: string | null) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)

beforeEach(() => jest.clearAllMocks())

describe("setVolunteerView", () => {
  it("blocks non-editors", async () => {
    asRole("VIEWER")
    expect(await setVolunteerView(1, true)).toEqual({ error: "Unauthorized" })
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it("mints a token when enabling and none exists", async () => {
    asRole("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, volunteerToken: null })
    const res = await setVolunteerView(1, true)
    expect(res).toHaveProperty("token")
    const token = (res as { token: string | null }).token
    expect(typeof token).toBe("string")
    expect(prisma.event.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: { volunteerToken: token } }),
    )
  })

  it("keeps the existing token when re-enabling", async () => {
    asRole("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, volunteerToken: "keepme" })
    const res = await setVolunteerView(1, true)
    expect(res).toEqual({ token: "keepme" })
  })

  it("nulls the token when disabling", async () => {
    asRole("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, volunteerToken: "old" })
    const res = await setVolunteerView(1, false)
    expect(res).toEqual({ token: null })
    expect(prisma.event.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { volunteerToken: null } }),
    )
  })

  it("404s a missing event", async () => {
    asRole("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await setVolunteerView(999, true)).toEqual({ error: "Event not found" })
  })

  it("rejects an invalid id before any DB access", async () => {
    asRole("ADMIN")
    expect(await setVolunteerView(-1, true)).toEqual({ error: "Invalid event" })
    expect(prisma.event.findUnique).not.toHaveBeenCalled()
    expect(prisma.event.update).not.toHaveBeenCalled()
  })
})

describe("regenerateVolunteerToken", () => {
  it("blocks non-editors", async () => {
    asRole("AUDITOR")
    expect(await regenerateVolunteerToken(1)).toEqual({ error: "Unauthorized" })
  })

  it("sets a fresh token", async () => {
    asRole("PASTOR")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
    const res = await regenerateVolunteerToken(1)
    const token = (res as { token: string | null }).token
    expect(typeof token).toBe("string")
    expect(token).not.toBe("")
  })
})
