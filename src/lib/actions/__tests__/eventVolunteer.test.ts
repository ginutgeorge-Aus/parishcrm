jest.mock("@/lib/featureFlags")
import { hashToken } from "@/lib/tokenHash"
import { setVolunteerView, regenerateVolunteerToken } from "@/lib/actions/eventAccess"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
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
    expect(prisma.event.updateMany).not.toHaveBeenCalled()
  })

  it("mints a token when enabling, writing only where no token exists yet", async () => {
    asRole("ADMIN")
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    const res = await setVolunteerView(1, true)
    expect(res).toHaveProperty("token")
    const token = (res as { token: string | null }).token
    expect(typeof token).toBe("string")
    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: 1, volunteerToken: null },
      data: { volunteerToken: hashToken(token as string) },
    })
  })

  it("refuses to turn on when already on (stale tab or a lost race), so the live shared link survives", async () => {
    asRole("ADMIN")
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, volunteerToken: "digest" })
    const res = await setVolunteerView(1, true)
    expect(res).toEqual({ error: "Volunteer view is already on. Reload the page." })
    expect(prisma.event.update).not.toHaveBeenCalled()
    expect(prisma.event.updateMany).toHaveBeenCalledTimes(1)
  })

  it("reports a changed state, without retrying, when another editor turned the view off after the enable missed", async () => {
    asRole("ADMIN")
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, volunteerToken: null })
    expect(await setVolunteerView(1, true)).toEqual({ error: "Volunteer view changed in the meantime. Reload the page." })
    expect(prisma.event.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it("nulls the token when disabling", async () => {
    asRole("ADMIN")
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    const res = await setVolunteerView(1, false)
    expect(res).toEqual({ token: null })
    expect(prisma.event.updateMany).toHaveBeenCalledWith({ where: { id: 1 }, data: { volunteerToken: null } })
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it("404s a missing event when enabling", async () => {
    asRole("ADMIN")
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await setVolunteerView(999, true)).toEqual({ error: "Event not found" })
  })

  it("404s a missing event when disabling", async () => {
    asRole("ADMIN")
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await setVolunteerView(999, false)).toEqual({ error: "Event not found" })
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it("rejects an invalid id before any DB access", async () => {
    asRole("ADMIN")
    expect(await setVolunteerView(-1, true)).toEqual({ error: "Invalid event" })
    expect(prisma.event.findUnique).not.toHaveBeenCalled()
    expect(prisma.event.update).not.toHaveBeenCalled()
    expect(prisma.event.updateMany).not.toHaveBeenCalled()
  })
})

describe("regenerateVolunteerToken", () => {
  it("blocks non-editors", async () => {
    asRole("AUDITOR")
    expect(await regenerateVolunteerToken(1)).toEqual({ error: "Unauthorized" })
    expect(prisma.event.updateMany).not.toHaveBeenCalled()
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it("sets a fresh token only while the view is on", async () => {
    asRole("PASTOR")
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    const res = await regenerateVolunteerToken(1)
    const token = (res as { token: string | null }).token
    expect(typeof token).toBe("string")
    expect(token).not.toBe("")
    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: 1, volunteerToken: { not: null } },
      data: { volunteerToken: hashToken(token as string) },
    })
  })

  it("refuses when the view is off, so a stale tab cannot re-enable a disabled link", async () => {
    asRole("PASTOR")
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, volunteerToken: null })
    expect(await regenerateVolunteerToken(1)).toEqual({ error: "Volunteer view is off. Reload the page." })
    // Only mutation attempt: the single guarded updateMany; no unguarded or fallback write.
    expect(prisma.event.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.event.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, volunteerToken: { not: null } } }),
    )
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it("reports a changed state, without retrying, when another editor turned the view on after the regenerate missed", async () => {
    asRole("PASTOR")
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, volunteerToken: "digest" })
    expect(await regenerateVolunteerToken(1)).toEqual({ error: "Volunteer view changed in the meantime. Reload the page." })
    expect(prisma.event.updateMany).toHaveBeenCalledTimes(1)
  })

  it("404s a missing event", async () => {
    asRole("PASTOR")
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await regenerateVolunteerToken(999)).toEqual({ error: "Event not found" })
  })
})
