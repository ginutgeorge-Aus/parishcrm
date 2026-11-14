/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    group: { findFirst: jest.fn() },
    groupMember: { findMany: jest.fn(), findFirst: jest.fn() },
    groupLeaderAccess: { findUnique: jest.fn() },
    rosterRole: { create: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    rosterService: { create: jest.fn(), createManyAndReturn: jest.fn(), findUnique: jest.fn(), deleteMany: jest.fn() },
    rosterSlot: { findUnique: jest.fn(), create: jest.fn(), createMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
    rosterAssignment: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
    personUnavailability: { findMany: jest.fn() },
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
import {
  addRosterSlot, archiveRosterRole, assignToRosterSlot, createRosterRole, createRosterService, deleteRosterService,
  generateSundayServices, removeRosterSlot, restoreRosterRole, suggestRosterAssignees, unassignRosterAssignment,
  updateRosterSlotNeeded,
} from "@/lib/actions/roster"

type Mocked<T> = { [K in keyof T]: { [M in keyof T[K]]: jest.Mock } }
const p = prisma as unknown as Mocked<{
  group: { findFirst: 0 }
  groupMember: { findMany: 0; findFirst: 0 }
  groupLeaderAccess: { findUnique: 0 }
  rosterRole: { create: 0; updateMany: 0; findMany: 0; findFirst: 0 }
  rosterService: { create: 0; createManyAndReturn: 0; findUnique: 0; deleteMany: 0 }
  rosterSlot: { findUnique: 0; create: 0; createMany: 0; update: 0; delete: 0 }
  rosterAssignment: { findMany: 0; findFirst: 0; findUnique: 0; create: 0; deleteMany: 0; count: 0 }
  personUnavailability: { findMany: 0 }
}> & { $transaction: jest.Mock; $queryRaw: jest.Mock }
const audit = logAuditTx as jest.Mock
const as = (role: UserRole | undefined) => (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "9", role } } : null)

const SERVICE_DATE = new Date("2026-12-06T00:00:00.000Z")
const slotRow = (over: Record<string, unknown> = {}) => ({
  id: 5, serviceId: 2, roleId: 3, needed: 2,
  role: { groupId: 4, archivedAt: null },
  service: { date: SERVICE_DATE },
  assignments: [],
  _count: { assignments: 0 },
  ...over,
})

/** FormData from a plain object. */
const form = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  as(UserRole.ADMIN)
  p.$queryRaw.mockResolvedValue([{ needed: 2 }])
  p.group.findFirst.mockResolvedValue({ id: 4 })
  p.groupMember.findMany.mockResolvedValue([])
  p.groupMember.findFirst.mockResolvedValue({ id: 1 })
  p.groupLeaderAccess.findUnique.mockResolvedValue(null)
  p.rosterRole.create.mockResolvedValue({ id: 3 })
  p.rosterRole.updateMany.mockResolvedValue({ count: 1 })
  p.rosterRole.findMany.mockResolvedValue([{ id: 3, defaultCount: 2 }])
  p.rosterRole.findFirst.mockResolvedValue({ id: 3 })
  p.rosterService.create.mockResolvedValue({ id: 2 })
  p.rosterService.createManyAndReturn.mockResolvedValue([{ id: 21 }])
  p.rosterSlot.createMany.mockResolvedValue({ count: 1 })
  p.rosterService.findUnique.mockResolvedValue({ id: 2 })
  p.rosterService.deleteMany.mockResolvedValue({ count: 1 })
  p.rosterSlot.findUnique.mockResolvedValue(slotRow())
  p.rosterSlot.create.mockResolvedValue({ id: 5 })
  p.rosterSlot.update.mockResolvedValue({})
  p.rosterSlot.delete.mockResolvedValue({})
  p.rosterAssignment.findMany.mockResolvedValue([])
  p.rosterAssignment.findFirst.mockResolvedValue(null)
  p.rosterAssignment.findUnique.mockResolvedValue({ serviceId: 2, slotId: 5, personId: 7, status: "PENDING", slot: { role: { groupId: 4 } } })
  p.rosterAssignment.create.mockResolvedValue({ id: 11 })
  p.rosterAssignment.deleteMany.mockResolvedValue({ count: 1 })
  p.rosterAssignment.count.mockResolvedValue(0)
  p.personUnavailability.findMany.mockResolvedValue([])
})

describe("staff-only actions", () => {
  const calls = {
    createRosterRole: () => createRosterRole(undefined, form({ name: "Reader", groupId: "4" })),
    archiveRosterRole: () => archiveRosterRole(3),
    restoreRosterRole: () => restoreRosterRole(3),
    createRosterService: () => createRosterService(undefined, form({ kind: "ADHOC", title: "Christmas", date: "2026-12-25", startTime: "23:00", endTime: "23:59" })),
    generateSundayServices: () => generateSundayServices(undefined, form({ from: "2026-12-01", to: "2026-12-31", startTime: "09:30", endTime: "11:00" })),
    deleteRosterService: () => deleteRosterService(2),
    addRosterSlot: () => addRosterSlot(2, 3, 1),
    updateRosterSlotNeeded: () => updateRosterSlotNeeded(5, 3),
    removeRosterSlot: () => removeRosterSlot(5),
  }

  it.each(Object.entries(calls))("%s refuses non-staff roles", async (_name, call) => {
    for (const role of [UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, UserRole.TEACHER, undefined]) {
      as(role)
      await expect(call()).resolves.toEqual({ error: "Unauthorized" })
    }
    expect(p.$transaction).not.toHaveBeenCalled()
  })

  it.each(Object.entries(calls))("%s works for every staff role and audits in the tx", async (_name, call) => {
    for (const role of [UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN]) {
      audit.mockClear()
      as(role)
      const r = await call()
      expect(r).toHaveProperty("success")
      expect(audit).toHaveBeenCalledTimes(1)
      expect(audit.mock.calls[0].slice(0, 3)).toEqual([prisma, 9, expect.stringMatching(/^ROSTER_/)])
    }
  })

  it.each(Object.entries(calls))("%s is blocked in the demo", async (_name, call) => {
    ;(assertNotDemo as jest.Mock).mockReturnValueOnce({ error: "Disabled in the live demo" })
    await expect(call()).resolves.toEqual({ error: "Disabled in the live demo" })
  })
})

describe("createRosterRole", () => {
  it("refuses an archived or missing group", async () => {
    p.group.findFirst.mockResolvedValue(null)
    await expect(createRosterRole(undefined, form({ name: "Reader", groupId: "4" }))).resolves.toEqual({ error: "Group not found" })
  })
  it("maps a duplicate name", async () => {
    p.rosterRole.create.mockRejectedValue({ code: "P2002" })
    await expect(createRosterRole(undefined, form({ name: "Reader", groupId: "4" }))).resolves.toEqual({ error: expect.stringContaining("already exists") })
  })
})

describe("createRosterService", () => {
  const base = { kind: "SUNDAY", title: "Sunday service", date: "2026-12-06", startTime: "09:30", endTime: "11:00" }
  it("stores Sydney times as UTC with a slot per live role", async () => {
    await createRosterService(undefined, form(base))
    expect(p.rosterService.create).toHaveBeenCalledWith({
      data: {
        kind: "SUNDAY", title: "Sunday service", location: "",
        date: new Date("2026-12-06T00:00:00.000Z"),
        startsAt: new Date("2026-12-05T22:30:00.000Z"),
        endsAt: new Date("2026-12-06T00:00:00.000Z"),
        weeklyKey: new Date("2026-12-05T22:30:00.000Z"),
        slots: { create: [{ roleId: 3, needed: 2 }] },
      },
      select: { id: true },
    })
    // Only roles whose group is live get a default slot.
    expect(p.rosterRole.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { archivedAt: null, group: { archivedAt: null } } }))
  })
  it("gives an ADHOC service no weekly key, so one-offs may share a start time", async () => {
    await createRosterService(undefined, form({ ...base, kind: "ADHOC", date: "2026-12-25" }))
    expect(p.rosterService.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "ADHOC", weeklyKey: null }) }))
  })
  it("refuses a SUNDAY service on a weekday", async () => {
    await expect(createRosterService(undefined, form({ ...base, date: "2026-12-07" }))).resolves.toEqual({ error: "A Sunday service must fall on a Sunday" })
  })
  it("refuses an end before the start", async () => {
    await expect(createRosterService(undefined, form({ ...base, endTime: "09:00" }))).resolves.toEqual({ error: "End time must be after the start time" })
  })
  it("maps a duplicate start time", async () => {
    p.rosterService.create.mockRejectedValue({ code: "P2002" })
    await expect(createRosterService(undefined, form(base))).resolves.toEqual({ error: expect.stringContaining("already starts") })
  })
})

describe("generateSundayServices", () => {
  const range = { from: "2026-12-01", to: "2026-12-31", startTime: "09:30", endTime: "11:00" }
  it("batch-inserts the Sundays in range, skipping existing ones by weekly key", async () => {
    // Sundays in Dec 2026: 6, 13, 20, 27 — say the 6th exists, so 3 come back.
    p.rosterService.createManyAndReturn.mockResolvedValue([{ id: 21 }, { id: 22 }, { id: 23 }])
    const r = await generateSundayServices(undefined, form(range))
    expect(r).toEqual({ success: "Created 3 Sunday services" })
    const arg = p.rosterService.createManyAndReturn.mock.calls[0][0]
    expect(arg.skipDuplicates).toBe(true)
    expect(arg.data.map((d: { weeklyKey: Date }) => d.weeklyKey.toISOString())).toEqual(
      ["2026-12-05T22:30:00.000Z", "2026-12-12T22:30:00.000Z", "2026-12-19T22:30:00.000Z", "2026-12-26T22:30:00.000Z"],
    )
    expect(arg.data[0]).toEqual(expect.objectContaining({ kind: "SUNDAY", title: "Sunday service", date: new Date("2026-12-06T00:00:00.000Z") }))
    expect(p.rosterSlot.createMany).toHaveBeenCalledWith({
      data: [{ serviceId: 21, roleId: 3, needed: 2 }, { serviceId: 22, roleId: 3, needed: 2 }, { serviceId: 23, roleId: 3, needed: 2 }],
    })
    expect(audit).toHaveBeenCalledWith(prisma, 9, "ROSTER_SUNDAYS_GENERATED", "RosterService", undefined, expect.objectContaining({ created: 3, skipped: 1 }))
  })
  it("does nothing when every Sunday exists", async () => {
    p.rosterService.createManyAndReturn.mockResolvedValue([])
    await expect(generateSundayServices(undefined, form(range))).resolves.toEqual({ success: "Those Sundays already exist" })
    expect(p.rosterSlot.createMany).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })
  it("caps the range before enumerating it", async () => {
    await expect(generateSundayServices(undefined, form({ ...range, to: "2027-12-31" }))).resolves.toEqual({ error: expect.stringContaining("at most") })
    await expect(generateSundayServices(undefined, form({ ...range, from: "0100-01-01", to: "9999-12-31" }))).resolves.toEqual({ error: expect.stringContaining("at most") })
    expect(p.$transaction).not.toHaveBeenCalled()
  })
  it("accepts exactly the maximum number of Sundays", async () => {
    // 2026-12-06 .. 2027-05-30 is 26 Sundays.
    p.rosterService.createManyAndReturn.mockResolvedValue([{ id: 21 }])
    await expect(generateSundayServices(undefined, form({ ...range, from: "2026-12-06", to: "2027-05-30" }))).resolves.toHaveProperty("success")
    expect(p.rosterService.createManyAndReturn.mock.calls[0][0].data).toHaveLength(26)
  })
  it("refuses a reversed range and one with no Sunday", async () => {
    await expect(generateSundayServices(undefined, form({ ...range, to: "2026-11-01" }))).resolves.toEqual({ error: expect.stringContaining("on or after") })
    await expect(generateSundayServices(undefined, form({ ...range, from: "2026-12-01", to: "2026-12-05" }))).resolves.toEqual({ error: "There is no Sunday in that range" })
  })
})

describe("slots", () => {
  it("addRosterSlot refuses an archived role and a duplicate", async () => {
    p.rosterRole.findFirst.mockResolvedValueOnce(null)
    await expect(addRosterSlot(2, 3, 1)).resolves.toEqual({ error: "Roster role not found" })
    p.rosterSlot.create.mockRejectedValueOnce({ code: "P2002" })
    await expect(addRosterSlot(2, 3, 1)).resolves.toEqual({ error: "This service already has that role" })
  })
  it("addRosterSlot validates the head count", async () => {
    await expect(addRosterSlot(2, 3, 0)).resolves.toEqual({ error: expect.stringContaining("at least 1") })
  })
  it("updateRosterSlotNeeded refuses to go below the people holding places", async () => {
    p.rosterSlot.findUnique.mockResolvedValue({ serviceId: 2, assignments: [{ status: "PENDING" }, { status: "CONFIRMED" }, { status: "DECLINED" }] })
    await expect(updateRosterSlotNeeded(5, 1)).resolves.toEqual({ error: expect.stringContaining("2 people") })
    expect(p.rosterSlot.update).not.toHaveBeenCalled()
  })
  it("removeRosterSlot refuses while people are rostered", async () => {
    p.rosterSlot.findUnique.mockResolvedValue({ serviceId: 2, roleId: 3, _count: { assignments: 1 } })
    await expect(removeRosterSlot(5)).resolves.toEqual({ error: expect.stringContaining("Remove the people") })
    expect(p.rosterSlot.delete).not.toHaveBeenCalled()
  })
  it("slot edits report a missing slot", async () => {
    p.$queryRaw.mockResolvedValue([])
    await expect(updateRosterSlotNeeded(5, 2)).resolves.toEqual({ error: "Slot not found" })
    await expect(removeRosterSlot(5)).resolves.toEqual({ error: "Slot not found" })
  })
})

describe("deleteRosterService", () => {
  it("records how many assignments went with it", async () => {
    p.rosterAssignment.count.mockResolvedValue(4)
    await deleteRosterService(2)
    expect(audit).toHaveBeenCalledWith(prisma, 9, "ROSTER_SERVICE_DELETED", "RosterService", 2, { assignments: 4 })
  })
  it("reports a missing service", async () => {
    p.rosterService.deleteMany.mockResolvedValue({ count: 0 })
    await expect(deleteRosterService(2)).resolves.toEqual({ error: "Service not found" })
  })
})

describe("assignment access", () => {
  it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.TEACHER, UserRole.HEADMASTER, undefined])("refuses %s", async (role) => {
    as(role)
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: "Unauthorized" })
    await expect(unassignRosterAssignment(11)).resolves.toEqual({ error: "Unauthorized" })
    await expect(suggestRosterAssignees(5)).resolves.toEqual({ error: "Unauthorized" })
  })
  it("refuses an organiser who does not lead the role's group", async () => {
    as(UserRole.EVENT_ORGANISER)
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: "Unauthorized" })
    await expect(unassignRosterAssignment(11)).resolves.toEqual({ error: "Unauthorized" })
    await expect(suggestRosterAssignees(5)).resolves.toEqual({ error: "Unauthorized" })
    expect(p.groupLeaderAccess.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { groupId_userId: { groupId: 4, userId: 9 } } }))
    expect(p.rosterAssignment.create).not.toHaveBeenCalled()
    expect(p.rosterAssignment.deleteMany).not.toHaveBeenCalled()
  })
  it("lets a leader of the role's group assign and unassign", async () => {
    as(UserRole.EVENT_ORGANISER)
    p.groupLeaderAccess.findUnique.mockResolvedValue({ id: 1 })
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ success: "Person rostered" })
    await expect(unassignRosterAssignment(11)).resolves.toEqual({ success: "Person removed from the roster" })
  })
  it("rejects bad ids before touching the DB", async () => {
    await expect(assignToRosterSlot(0, 7)).resolves.toEqual({ error: "Invalid slot" })
    await expect(assignToRosterSlot(5, -1)).resolves.toEqual({ error: "Invalid person" })
    await expect(unassignRosterAssignment(2 ** 31)).resolves.toEqual({ error: "Invalid assignment" })
  })
  it("is blocked in the demo", async () => {
    ;(assertNotDemo as jest.Mock).mockReturnValueOnce({ error: "Disabled in the live demo" })
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: "Disabled in the live demo" })
  })
})

describe("assignToRosterSlot", () => {
  it("creates a PENDING row under a slot lock and audits it", async () => {
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ success: "Person rostered" })
    expect(p.$queryRaw).toHaveBeenCalled()
    expect(p.rosterAssignment.create).toHaveBeenCalledWith({ data: { slotId: 5, serviceId: 2, personId: 7, assignedById: 9 }, select: { id: true } })
    expect(audit).toHaveBeenCalledWith(prisma, 9, "ROSTER_ASSIGNED", "RosterAssignment", 11, { slotId: 5, serviceId: 2, personId: 7 })
  })
  it("refuses a non-member of the role's group", async () => {
    p.groupMember.findFirst.mockResolvedValue(null)
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: expect.stringContaining("not a member") })
    expect(p.groupMember.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { groupId: 4, personId: 7, group: { archivedAt: null }, person: { archivedAt: null } },
    }))
  })
  it("refuses someone already rostered at the service", async () => {
    p.rosterAssignment.findFirst.mockResolvedValue({ status: "CONFIRMED" })
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: "This person is already rostered at this service" })
  })
  it("tells staff to clear a declined entry first", async () => {
    p.rosterAssignment.findFirst.mockResolvedValue({ status: "DECLINED" })
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: expect.stringContaining("declined") })
  })
  it("uses the head count read under the slot lock, not the earlier read", async () => {
    // loadSlot saw needed=2 (slotRow); a concurrent edit lowered it to 1.
    p.$queryRaw.mockResolvedValue([{ needed: 1 }])
    p.rosterAssignment.findMany.mockResolvedValue([{ status: "PENDING" }])
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: "This slot is already full" })
  })
  it("maps a slot deleted mid-assign (FK error) to slot not found", async () => {
    p.rosterAssignment.create.mockRejectedValue({ code: "P2003" })
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: "Slot not found" })
  })
  it("refuses someone unavailable that day", async () => {
    p.personUnavailability.findMany.mockResolvedValue([
      { personId: 7, startDate: new Date("2026-12-01T00:00:00.000Z"), endDate: new Date("2026-12-10T00:00:00.000Z") },
    ])
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: "This person is unavailable on that date" })
  })
  it("refuses a full slot but counts declined rows as free", async () => {
    p.rosterAssignment.findMany.mockResolvedValue([{ status: "PENDING" }, { status: "CONFIRMED" }])
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: "This slot is already full" })
    p.rosterAssignment.findMany.mockResolvedValue([{ status: "PENDING" }, { status: "DECLINED" }])
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ success: "Person rostered" })
  })
  it("maps a concurrent double-booking (unique key) to the conflict message", async () => {
    p.rosterAssignment.create.mockRejectedValue({ code: "P2002" })
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: "This person is already rostered at this service" })
  })
  it("refuses an archived role and a missing slot", async () => {
    p.rosterSlot.findUnique.mockResolvedValueOnce(slotRow({ role: { groupId: 4, archivedAt: new Date() } }))
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: "Roster role not found" })
    p.rosterSlot.findUnique.mockResolvedValueOnce(null)
    await expect(assignToRosterSlot(5, 7)).resolves.toEqual({ error: "Slot not found" })
  })
})

describe("unassignRosterAssignment", () => {
  it("deletes and audits with the prior status", async () => {
    await unassignRosterAssignment(11)
    expect(audit).toHaveBeenCalledWith(prisma, 9, "ROSTER_UNASSIGNED", "RosterAssignment", 11, { slotId: 5, serviceId: 2, personId: 7, status: "PENDING" })
  })
  it("reports a missing assignment", async () => {
    p.rosterAssignment.findUnique.mockResolvedValueOnce(null)
    await expect(unassignRosterAssignment(11)).resolves.toEqual({ error: "Assignment not found" })
    p.rosterAssignment.deleteMany.mockResolvedValueOnce({ count: 0 })
    await expect(unassignRosterAssignment(11)).resolves.toEqual({ error: "Assignment not found" })
  })
})

describe("suggestRosterAssignees", () => {
  it("ranks eligible members by least recently served in the role, skipping conflicts", async () => {
    p.groupMember.findMany.mockResolvedValue([
      { person: { id: 1, firstName: "Ann", lastName: "Ash" } },
      { person: { id: 2, firstName: "Ben", lastName: "Bell" } },
      { person: { id: 3, firstName: "Cal", lastName: "Cole" } },
      { person: { id: 4, firstName: "Dee", lastName: "Dunn" } },
    ])
    p.rosterAssignment.findMany.mockImplementation((args: { where: { serviceId?: number } }) =>
      Promise.resolve(args.where.serviceId
        ? [{ personId: 4 }]
        : [
            { personId: 1, slot: { service: { date: new Date("2026-11-29T00:00:00.000Z") } } },
            { personId: 2, slot: { service: { date: new Date("2026-10-04T00:00:00.000Z") } } },
          ]))
    const r = await suggestRosterAssignees(5)
    expect(r).toEqual({
      suggestions: [
        { personId: 3, firstName: "Cal", lastName: "Cole", lastServedYMD: null },
        { personId: 2, firstName: "Ben", lastName: "Bell", lastServedYMD: "2026-10-04" },
        { personId: 1, firstName: "Ann", lastName: "Ash", lastServedYMD: "2026-11-29" },
      ],
    })
    // History is scoped to this role, earlier services, and places held.
    expect(p.rosterAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { personId: { in: [1, 2, 3, 4] }, status: { not: "DECLINED" }, slot: { roleId: 3, service: { date: { lt: SERVICE_DATE } } } },
      distinct: ["personId"],
    }))
  })
  it("refuses an archived role", async () => {
    p.rosterSlot.findUnique.mockResolvedValueOnce(slotRow({ role: { groupId: 4, archivedAt: new Date() } }))
    await expect(suggestRosterAssignees(5)).resolves.toEqual({ error: "Roster role not found" })
  })
  it("returns no suggestions for an empty group", async () => {
    await expect(suggestRosterAssignees(5)).resolves.toEqual({ suggestions: [] })
  })
})
