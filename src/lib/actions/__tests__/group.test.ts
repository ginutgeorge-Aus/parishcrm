/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    group: { create: jest.fn(), updateMany: jest.fn() },
    groupMember: { createMany: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
    groupLeaderAccess: { findUnique: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    person: { findMany: jest.fn() },
    user: { findFirst: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  }
  m.$transaction.mockImplementation((fn: (tx: typeof m) => unknown) => fn(m))
  return { prisma: m }
})
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }) }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import {
  addGroupLeaderAccess, addGroupMember, archiveGroup, createGroup, removeGroupLeaderAccess,
  removeGroupMember, restoreGroup, searchGroupCandidates, updateGroup, updateGroupMember,
} from "@/lib/actions/group"

const as = (role: UserRole | undefined) => (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "9", role } } : null)
const p = prisma as unknown as {
  group: { create: jest.Mock; updateMany: jest.Mock }
  groupMember: { createMany: jest.Mock; updateMany: jest.Mock; deleteMany: jest.Mock }
  groupLeaderAccess: { findUnique: jest.Mock; createMany: jest.Mock; deleteMany: jest.Mock }
  person: { findMany: jest.Mock }
  user: { findFirst: jest.Mock }
  $transaction: jest.Mock
  $queryRaw: jest.Mock
}
const audit = logAuditTx as jest.Mock

/** Row-lock queries: Group row live/archived, Person row live/archived. */
const locks = (groupLive = true, personLive = true) =>
  p.$queryRaw.mockImplementation((sql: TemplateStringsArray) => {
    const q = sql.join("?")
    if (q.includes('FROM "Group"')) return Promise.resolve(groupLive ? [{ id: 4 }] : [])
    if (q.includes('FROM "Person"')) return Promise.resolve(personLive ? [{ id: 3 }] : [])
    return Promise.resolve([])
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
  locks()
  p.group.create.mockResolvedValue({ id: 4 })
  p.group.updateMany.mockResolvedValue({ count: 1 })
  p.groupMember.createMany.mockResolvedValue({ count: 1 })
  p.groupMember.updateMany.mockResolvedValue({ count: 1 })
  p.groupMember.deleteMany.mockResolvedValue({ count: 1 })
  p.groupLeaderAccess.createMany.mockResolvedValue({ count: 1 })
  p.groupLeaderAccess.deleteMany.mockResolvedValue({ count: 1 })
  p.groupLeaderAccess.findUnique.mockResolvedValue(null)
  p.user.findFirst.mockResolvedValue({ role: UserRole.EVENT_ORGANISER })
  p.person.findMany.mockResolvedValue([])
})

/** The tx passed to logAuditTx must be the transaction client, i.e. audit ran inside the tx. */
function expectAuditInTx(action: string, metadata?: Record<string, unknown>) {
  expect(p.$transaction).toHaveBeenCalled()
  expect(audit).toHaveBeenCalledWith(prisma, 9, action, "Group", 4, ...(metadata ? [metadata] : []))
}

describe("group manager actions", () => {
  const managerCalls = {
    createGroup: () => createGroup(undefined, form({ name: "Choir", category: "MINISTRY" })),
    updateGroup: () => updateGroup(4, undefined, form({ name: "Choir", category: "MINISTRY" })),
    archiveGroup: () => archiveGroup(4),
    restoreGroup: () => restoreGroup(4),
    addGroupLeaderAccess: () => addGroupLeaderAccess(4, 7),
    removeGroupLeaderAccess: () => removeGroupLeaderAccess(4, 7),
  }

  it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, undefined])("deny %s on every manager action", async (role) => {
    as(role)
    // A linked organiser is still not a manager.
    p.groupLeaderAccess.findUnique.mockResolvedValue({ id: 1 })
    for (const call of Object.values(managerCalls)) {
      await expect(call()).resolves.toEqual({ error: "Unauthorized" })
    }
    expect(p.$transaction).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it("blocks writes in demo mode", async () => {
    ;(assertNotDemo as jest.Mock).mockReturnValueOnce({ error: "Demo" })
    await expect(archiveGroup(4)).resolves.toEqual({ error: "Demo" })
    expect(p.$transaction).not.toHaveBeenCalled()
  })

  it.each([UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN])("%s creates a group with an audit row in the tx, then redirects", async (role) => {
    as(role)
    await expect(createGroup(undefined, form({ name: " Choir ", category: "MINISTRY", description: "Sings" }))).rejects.toThrow("REDIRECT:/groups/4")
    expect(p.group.create).toHaveBeenCalledWith({ data: { name: "Choir", category: "MINISTRY", description: "Sings" }, select: { id: true } })
    expectAuditInTx("GROUP_CREATED", { category: "MINISTRY" })
  })

  it("rejects an invalid form and a duplicate name", async () => {
    await expect(createGroup(undefined, form({ name: "", category: "MINISTRY" }))).resolves.toEqual({ error: "Name is required" })
    p.group.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }))
    await expect(createGroup(undefined, form({ name: "Choir", category: "MINISTRY" }))).resolves.toEqual({
      error: "A group with this name already exists (it may be archived)",
    })
  })

  it("updates only a live group", async () => {
    await expect(updateGroup(4, undefined, form({ name: "Choir", category: "COMMITTEE" }))).rejects.toThrow("REDIRECT:/groups/4")
    expect(p.group.updateMany).toHaveBeenCalledWith({ where: { id: 4, archivedAt: null }, data: { name: "Choir", category: "COMMITTEE", description: "" } })
    expectAuditInTx("GROUP_UPDATED", { category: "COMMITTEE" })
    audit.mockClear()
    p.group.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(updateGroup(4, undefined, form({ name: "Choir", category: "COMMITTEE" }))).resolves.toEqual({ error: "Group not found" })
    expect(audit).not.toHaveBeenCalled()
  })

  it("archives and restores, auditing only a real change", async () => {
    await expect(archiveGroup(4)).resolves.toBeUndefined()
    expect(p.group.updateMany).toHaveBeenCalledWith({ where: { id: 4, archivedAt: null }, data: { archivedAt: expect.any(Date) } })
    expectAuditInTx("GROUP_ARCHIVED")
    await expect(restoreGroup(4)).resolves.toBeUndefined()
    expect(p.group.updateMany).toHaveBeenLastCalledWith({ where: { id: 4, archivedAt: { not: null } }, data: { archivedAt: null } })
    expectAuditInTx("GROUP_RESTORED")
    audit.mockClear()
    p.group.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(archiveGroup(4)).resolves.toEqual({ error: "Group not found" })
    expect(audit).not.toHaveBeenCalled()
    await expect(archiveGroup(0)).resolves.toEqual({ error: "Invalid group" })
  })

  it("links only a live Event organiser login to a live group", async () => {
    await expect(addGroupLeaderAccess(4, 7)).resolves.toBeUndefined()
    expect(p.groupLeaderAccess.createMany).toHaveBeenCalledWith({ data: [{ groupId: 4, userId: 7 }], skipDuplicates: true })
    expectAuditInTx("GROUP_LEADER_ACCESS_ADDED", { targetUserId: 7 })

    p.user.findFirst.mockResolvedValueOnce({ role: UserRole.VIEWER })
    await expect(addGroupLeaderAccess(4, 7)).resolves.toEqual({ error: "User is not an event organiser" })
    p.user.findFirst.mockResolvedValueOnce(null)
    await expect(addGroupLeaderAccess(4, 7)).resolves.toEqual({ error: "User not found" })
    locks(false)
    await expect(addGroupLeaderAccess(4, 7)).resolves.toEqual({ error: "Group not found" })
  })

  it("unlinks a leader login with an audit row in the tx", async () => {
    await expect(removeGroupLeaderAccess(4, 7)).resolves.toBeUndefined()
    expect(p.groupLeaderAccess.deleteMany).toHaveBeenCalledWith({ where: { groupId: 4, userId: 7 } })
    expectAuditInTx("GROUP_LEADER_ACCESS_REMOVED", { targetUserId: 7 })
  })
})

describe("membership actions", () => {
  const memberCalls = {
    addGroupMember: () => addGroupMember(4, 3),
    updateGroupMember: () => updateGroupMember(4, 3, "LEADER", "Secretary"),
    removeGroupMember: () => removeGroupMember(4, 3),
    searchGroupCandidates: () => searchGroupCandidates(4, "Jo"),
  }

  it.each([UserRole.VIEWER, UserRole.AUDITOR, undefined])("deny %s", async (role) => {
    as(role)
    for (const call of Object.values(memberCalls)) {
      await expect(call()).resolves.toEqual({ error: "Unauthorized" })
    }
    expect(p.$transaction).not.toHaveBeenCalled()
    expect(p.person.findMany).not.toHaveBeenCalled()
  })

  it("denies an organiser on a group they are not linked to", async () => {
    as(UserRole.EVENT_ORGANISER)
    p.groupLeaderAccess.findUnique.mockResolvedValue(null)
    for (const call of Object.values(memberCalls)) {
      await expect(call()).resolves.toEqual({ error: "Unauthorized" })
    }
    expect(p.groupLeaderAccess.findUnique).toHaveBeenCalledWith({ where: { groupId_userId: { groupId: 4, userId: 9 } }, select: { id: true } })
    expect(p.$transaction).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it("lets a linked organiser add, update and remove members", async () => {
    as(UserRole.EVENT_ORGANISER)
    p.groupLeaderAccess.findUnique.mockResolvedValue({ id: 1 })
    await expect(addGroupMember(4, 3)).resolves.toBeUndefined()
    expectAuditInTx("GROUP_MEMBER_ADDED", { personId: 3 })
    await expect(updateGroupMember(4, 3, "LEADER", " Secretary ")).resolves.toBeUndefined()
    expect(p.groupMember.updateMany).toHaveBeenCalledWith({ where: { groupId: 4, personId: 3 }, data: { role: "LEADER", title: "Secretary" } })
    expectAuditInTx("GROUP_MEMBER_UPDATED", { personId: 3, role: "LEADER" })
    await expect(removeGroupMember(4, 3)).resolves.toBeUndefined()
    expect(p.groupMember.deleteMany).toHaveBeenCalledWith({ where: { groupId: 4, personId: 3 } })
    expectAuditInTx("GROUP_MEMBER_REMOVED", { personId: 3 })
  })

  it("adds idempotently: an existing member writes no audit row", async () => {
    p.groupMember.createMany.mockResolvedValueOnce({ count: 0 })
    await expect(addGroupMember(4, 3)).resolves.toBeUndefined()
    expect(p.groupMember.createMany).toHaveBeenCalledWith({ data: [{ groupId: 4, personId: 3 }], skipDuplicates: true })
    expect(audit).not.toHaveBeenCalled()
  })

  it("refuses an archived group or an archived person, inside the tx", async () => {
    locks(false)
    await expect(addGroupMember(4, 3)).resolves.toEqual({ error: "Group not found" })
    await expect(updateGroupMember(4, 3, "MEMBER", "")).resolves.toEqual({ error: "Group not found" })
    await expect(removeGroupMember(4, 3)).resolves.toEqual({ error: "Group not found" })
    locks(true, false)
    await expect(addGroupMember(4, 3)).resolves.toEqual({ error: "Person not found" })
    expect(p.groupMember.createMany).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it("validates ids, role and title", async () => {
    await expect(addGroupMember(4, -1)).resolves.toEqual({ error: "Invalid person" })
    await expect(addGroupMember(0, 3)).resolves.toEqual({ error: "Invalid group" })
    await expect(updateGroupMember(4, 3, "OWNER", "")).resolves.toEqual({ error: "Invalid role" })
    await expect(updateGroupMember(4, 3, "MEMBER", "x".repeat(61))).resolves.toEqual({ error: "Title must be 60 characters or fewer" })
    p.groupMember.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(updateGroupMember(4, 3, "MEMBER", "")).resolves.toEqual({ error: "Not a member of this group" })
    expect(audit).not.toHaveBeenCalled()
  })

  it("searches live non-members by name, names only, short queries skipped", async () => {
    await expect(searchGroupCandidates(4, "J")).resolves.toEqual({ people: [] })
    expect(p.person.findMany).not.toHaveBeenCalled()
    p.person.findMany.mockResolvedValueOnce([{ id: 3, firstName: "Jo", lastName: "Doe", family: { name: "Doe" } }])
    await expect(searchGroupCandidates(4, "jo doe")).resolves.toEqual({ people: [{ id: 3, name: "Jo Doe", familyName: "Doe" }] })
    const arg = p.person.findMany.mock.calls[0][0]
    expect(arg.where.archivedAt).toBeNull()
    expect(arg.where.groupMemberships).toEqual({ none: { groupId: 4 } })
    expect(arg.select).not.toHaveProperty("email")
    expect(arg.take).toBe(20)
  })
})
