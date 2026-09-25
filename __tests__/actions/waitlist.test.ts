/** @jest-environment node */
import { markWaitlistNotified } from "@/lib/actions/waitlist"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { logAudit } from "@/lib/audit"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    waitlist: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}))

const mockSession = (role: string) =>
  (auth as jest.Mock).mockResolvedValue({ user: { role, id: "1" } })

beforeEach(() => { jest.clearAllMocks() })

describe("markWaitlistNotified", () => {
  it("returns error for VIEWER", async () => {
    mockSession("VIEWER")
    const result = await markWaitlistNotified(1, 1, true)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns error when waitlist belongs to a different event (IDOR guard)", async () => {
    mockSession("ADMIN")
    ;(prisma.waitlist.findUnique as jest.Mock).mockResolvedValue({ eventId: 99 })
    const result = await markWaitlistNotified(1, 1, true)
    expect(result).toEqual({ error: "Waitlist entry not found" })
    expect(prisma.waitlist.updateMany).not.toHaveBeenCalled()
  })

  it("sets notifiedAt when notified=true", async () => {
    mockSession("OFFICE_ADMIN")
    ;(prisma.waitlist.findUnique as jest.Mock).mockResolvedValue({ eventId: 1 })
    ;(prisma.waitlist.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await markWaitlistNotified(5, 1, true)
    expect(prisma.waitlist.updateMany).toHaveBeenCalledWith({
      where: { id: 5, eventId: 1 },
      data: { notifiedAt: expect.any(Date) },
    })
    expect(logAudit).toHaveBeenCalledWith(1, "WAITLIST_NOTIFIED", "Waitlist", 5, { eventId: 1 })
    expect(revalidatePath).toHaveBeenCalledWith("/events/1/waitlist")
  })

  it("clears notifiedAt when notified=false", async () => {
    mockSession("ADMIN")
    ;(prisma.waitlist.findUnique as jest.Mock).mockResolvedValue({ eventId: 1 })
    ;(prisma.waitlist.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await markWaitlistNotified(5, 1, false)
    expect(prisma.waitlist.updateMany).toHaveBeenCalledWith({
      where: { id: 5, eventId: 1 },
      data: { notifiedAt: null },
    })
    expect(logAudit).toHaveBeenCalledWith(1, "WAITLIST_NOTIFIED", "Waitlist", 5, { eventId: 1 })
    expect(revalidatePath).toHaveBeenCalledWith("/events/1/waitlist")
  })

  it("returns not-found when the row is deleted between read and write", async () => {
    mockSession("ADMIN")
    ;(prisma.waitlist.findUnique as jest.Mock).mockResolvedValue({ eventId: 1 })
    ;(prisma.waitlist.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    const result = await markWaitlistNotified(5, 1, true)
    expect(result).toEqual({ error: "Waitlist entry not found" })
    expect(logAudit).not.toHaveBeenCalled()
  })
})
