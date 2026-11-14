/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    groupLeaderAccess: { findFirst: jest.fn() },
    personUnavailability: { create: jest.fn(), count: jest.fn(), findUnique: jest.fn(), deleteMany: jest.fn() },
    rosterAssignment: { findMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  }
  m.$transaction.mockImplementation((fn: (tx: typeof m) => unknown) => fn(m))
  return { prisma: m }
})
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { addPersonUnavailability, removePersonUnavailability } from "@/lib/actions/personUnavailability"

type M = Record<string, jest.Mock>
const p = prisma as unknown as {
  groupLeaderAccess: M; personUnavailability: M; rosterAssignment: M; $transaction: jest.Mock; $queryRaw: jest.Mock
}
const as = (role: UserRole | undefined) => (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "9", role } } : null)
const form = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}
const add = (o: Record<string, string>, personId = 7) => addPersonUnavailability(personId, undefined, form(o))

beforeEach(() => {
  jest.clearAllMocks()
  as(UserRole.OFFICE_ADMIN)
  ;(assertNotDemo as jest.Mock).mockReturnValue(null)
  p.$queryRaw.mockResolvedValue([{ id: 7 }])
  p.groupLeaderAccess.findFirst.mockResolvedValue(null)
  p.personUnavailability.count.mockResolvedValue(0)
  p.personUnavailability.create.mockResolvedValue({ id: 31 })
  p.personUnavailability.findUnique.mockResolvedValue({
    personId: 7, startDate: new Date("2026-12-06T00:00:00.000Z"), endDate: new Date("2026-12-13T00:00:00.000Z"),
  })
  p.personUnavailability.deleteMany.mockResolvedValue({ count: 1 })
  p.rosterAssignment.findMany.mockResolvedValue([])
})

describe("addPersonUnavailability", () => {
  it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.TEACHER, UserRole.HEADMASTER, undefined])("refuses %s", async (role) => {
    as(role)
    await expect(add({ from: "2026-12-06" })).resolves.toEqual({ error: "Unauthorized" })
    expect(p.personUnavailability.create).not.toHaveBeenCalled()
  })

  it("refuses an organiser who leads no group of this person, allows one who does", async () => {
    as(UserRole.EVENT_ORGANISER)
    await expect(add({ from: "2026-12-06" })).resolves.toEqual({ error: "Unauthorized" })
    p.groupLeaderAccess.findFirst.mockResolvedValue({ id: 1 })
    await expect(add({ from: "2026-12-06" })).resolves.toEqual({ success: "Unavailable dates saved" })
    expect(p.groupLeaderAccess.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 9, group: { archivedAt: null, members: { some: { personId: 7 } } } },
    }))
  })

  it("blocks the demo", async () => {
    ;(assertNotDemo as jest.Mock).mockReturnValue({ error: "demo" })
    await expect(add({ from: "2026-12-06" })).resolves.toEqual({ error: "demo" })
  })

  it("saves a single day (to defaults to from) and audits in the tx", async () => {
    await expect(add({ from: "2026-12-06" })).resolves.toEqual({ success: "Unavailable dates saved" })
    expect(p.personUnavailability.create).toHaveBeenCalledWith({
      data: { personId: 7, startDate: new Date("2026-12-06T00:00:00.000Z"), endDate: new Date("2026-12-06T00:00:00.000Z") },
      select: { id: true },
    })
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 9, "ROSTER_UNAVAILABLE_ADDED", "PersonUnavailability", 31, { personId: 7, from: "2026-12-06", to: "2026-12-06" })
  })

  it.each([
    [{ from: "", to: "" }, "Enter a valid date"],
    [{ from: "2026-02-30" }, "Enter a valid date"],
    [{ from: "2026-12-13", to: "2026-12-06" }, "End date must be on or after the start date"],
    [{ from: "2026-01-01", to: "2027-01-02" }, "A range can be at most 366 days"],
  ])("rejects bad input %j", async (input, message) => {
    await expect(add(input as Record<string, string>)).resolves.toEqual({ error: message })
    expect(p.personUnavailability.create).not.toHaveBeenCalled()
  })

  it("rejects an invalid or unknown person and a full list", async () => {
    await expect(add({ from: "2026-12-06" }, 0)).resolves.toEqual({ error: "Invalid person" })
    p.$queryRaw.mockResolvedValue([])
    await expect(add({ from: "2026-12-06" })).resolves.toEqual({ error: "Person not found" })
    expect(p.personUnavailability.create).not.toHaveBeenCalled()
  })

  it("caps only current ranges, counted and created under the person lock in one transaction", async () => {
    p.personUnavailability.count.mockResolvedValue(100)
    await expect(add({ from: "2026-12-06" })).resolves.toEqual({ error: expect.stringContaining("At most 100") })
    expect(p.personUnavailability.create).not.toHaveBeenCalled()
    expect(p.personUnavailability.count).toHaveBeenCalledWith({ where: { personId: 7, endDate: { gte: expect.any(Date) } } })
    p.personUnavailability.count.mockResolvedValue(99)
    await expect(add({ from: "2026-12-06" })).resolves.toEqual({ success: "Unavailable dates saved" })
    expect(p.$transaction).toHaveBeenCalledTimes(2)
    expect(p.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it("saves but warns when the person is already rostered in the range", async () => {
    p.rosterAssignment.findMany.mockResolvedValue([
      { slot: { service: { title: "Sunday service", date: new Date("2026-12-06T00:00:00.000Z") } } },
    ])
    const r = await add({ from: "2026-12-05", to: "2026-12-07" })
    expect(r).toEqual({ success: expect.stringContaining("Warning: already rostered at Sunday service on 2026-12-06") })
    expect(p.personUnavailability.create).toHaveBeenCalled()
    expect(p.rosterAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ personId: 7, status: { not: "DECLINED" } }),
    }))
  })
})

describe("removePersonUnavailability", () => {
  it("removes a range and audits it", async () => {
    await expect(removePersonUnavailability(31)).resolves.toEqual({ success: "Unavailable dates removed" })
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 9, "ROSTER_UNAVAILABLE_REMOVED", "PersonUnavailability", 31, { personId: 7, from: "2026-12-06", to: "2026-12-13" })
  })

  it("authorises against the row's own person, not a client id", async () => {
    as(UserRole.EVENT_ORGANISER)
    await expect(removePersonUnavailability(31)).resolves.toEqual({ error: "Unauthorized" })
    expect(p.groupLeaderAccess.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ group: expect.objectContaining({ members: { some: { personId: 7 } } }) }),
    }))
    expect(p.personUnavailability.deleteMany).not.toHaveBeenCalled()
  })

  it("refuses a VIEWER before any row lookup, so existing ids cannot be probed", async () => {
    as(UserRole.VIEWER)
    await expect(removePersonUnavailability(31)).resolves.toEqual({ error: "Unauthorized" })
    await expect(removePersonUnavailability(999999)).resolves.toEqual({ error: "Unauthorized" })
    await expect(removePersonUnavailability(-1)).resolves.toEqual({ error: "Unauthorized" })
    expect(p.personUnavailability.findUnique).not.toHaveBeenCalled()
  })

  it("handles bad id, missing row and a concurrent delete", async () => {
    await expect(removePersonUnavailability(-1)).resolves.toEqual({ error: "Invalid entry" })
    p.personUnavailability.findUnique.mockResolvedValue(null)
    await expect(removePersonUnavailability(31)).resolves.toEqual({ error: "Entry not found" })
    p.personUnavailability.findUnique.mockResolvedValue({ personId: 7, startDate: new Date(), endDate: new Date() })
    p.personUnavailability.deleteMany.mockResolvedValue({ count: 0 })
    await expect(removePersonUnavailability(31)).resolves.toEqual({ error: "Entry not found" })
    expect(logAuditTx).not.toHaveBeenCalled()
  })
})
