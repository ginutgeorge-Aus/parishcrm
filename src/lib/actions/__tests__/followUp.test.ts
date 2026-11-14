/** @jest-environment node */
import { FollowUpStatus, UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    followUpTask: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    person: { findUnique: jest.fn() },
    family: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  }
  m.$transaction.mockImplementation((fn: (tx: typeof m) => unknown) => fn(m))
  return { prisma: m }
})
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/dates", () => ({
  sydneyTodayYMD: jest.fn(() => "2026-11-14"),
  sydneyToday: jest.fn(() => new Date("2026-11-14T00:00:00.000Z")),
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  safeDecrypt: jest.fn((v: string) => (v === "BROKEN" ? "[decryption error]" : v.replace(/^enc:/, ""))),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import {
  countMyDueFollowUps,
  createFollowUpTask,
  deleteFollowUpTask,
  getFollowUpTask,
  listFollowUpTasks,
  setFollowUpStatus,
  updateFollowUpTask,
} from "@/lib/actions/followUp"

const as = (role: UserRole | undefined, id = "9") =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id, role } } : null)
type M = jest.Mock
const p = prisma as unknown as {
  followUpTask: Record<"create" | "findFirst" | "findUnique" | "findMany" | "updateMany" | "deleteMany" | "count", M>
  person: { findUnique: M }
  family: { findUnique: M }
  user: { findUnique: M }
  $transaction: M
}
const audit = logAuditTx as M

const LIVE = { OR: [{ person: { is: { archivedAt: null } } }, { family: { is: { archivedAt: null } } }] }
const NON_MANAGERS = [UserRole.OFFICE_ADMIN, UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, UserRole.TEACHER, undefined]
const NO_SCOPE = [UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, UserRole.HEADMASTER, UserRole.TEACHER, undefined]

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: "enc:Visit",
  notes: "enc:Bring card",
  status: FollowUpStatus.OPEN,
  dueDate: new Date("2026-11-10T00:00:00Z"),
  personId: 3,
  familyId: null,
  assigneeId: 9,
  completedAt: null,
  createdAt: new Date("2026-11-01T00:00:00Z"),
  updatedAt: new Date("2026-11-01T00:00:00Z"),
  person: { firstName: "Sam", lastName: "Demo" },
  family: null,
  assignee: { name: "Office" },
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  as(UserRole.PASTOR, "1")
  p.person.findUnique.mockResolvedValue({ archivedAt: null })
  p.family.findUnique.mockResolvedValue({ archivedAt: null })
  p.user.findUnique.mockResolvedValue({ role: UserRole.OFFICE_ADMIN, archivedAt: null })
  p.followUpTask.create.mockResolvedValue({ id: 11 })
  p.followUpTask.updateMany.mockResolvedValue({ count: 1 })
  p.followUpTask.deleteMany.mockResolvedValue({ count: 1 })
  p.followUpTask.findMany.mockResolvedValue([row()])
})

describe("createFollowUpTask", () => {
  const valid = { title: " Visit ", notes: "Bring card", personId: 3, assigneeId: 9, dueDate: "2026-11-20" }

  it.each(NON_MANAGERS)("rejects role %s", async (role) => {
    as(role)
    expect(await createFollowUpTask(valid)).toEqual({ error: "Unauthorized" })
    expect(p.followUpTask.create).not.toHaveBeenCalled()
  })

  it("creates an encrypted task and audits it in the transaction", async () => {
    expect(await createFollowUpTask(valid)).toEqual({ id: 11 })
    expect(p.followUpTask.create).toHaveBeenCalledWith({
      data: {
        title: "enc:Visit",
        notes: "enc:Bring card",
        personId: 3,
        familyId: null,
        assigneeId: 9,
        dueDate: new Date("2026-11-20T00:00:00.000Z"),
        createdById: 1,
      },
      select: { id: true },
    })
    expect(audit).toHaveBeenCalledWith(expect.anything(), 1, "FOLLOW_UP_CREATED", "FollowUpTask", 11, {
      personId: 3,
      familyId: null,
      assigneeId: 9,
    })
  })

  it("requires exactly one target", async () => {
    expect(await createFollowUpTask({ title: "x" })).toEqual({ error: "Choose a person or a family" })
    expect(await createFollowUpTask({ title: "x", personId: 3, familyId: 4 })).toEqual({
      error: "Choose a person or a family",
    })
  })

  it("rejects an archived person or family", async () => {
    p.person.findUnique.mockResolvedValue({ archivedAt: new Date() })
    expect(await createFollowUpTask(valid)).toEqual({ error: "Person not found" })
    p.family.findUnique.mockResolvedValue(null)
    expect(await createFollowUpTask({ title: "x", familyId: 4 })).toEqual({ error: "Family not found" })
    expect(p.followUpTask.create).not.toHaveBeenCalled()
  })

  it.each([
    ["an AUDITOR", { role: UserRole.AUDITOR, archivedAt: null }],
    ["a read-only VIEWER", { role: UserRole.VIEWER, archivedAt: null }],
    ["an archived login", { role: UserRole.OFFICE_ADMIN, archivedAt: new Date() }],
    ["a missing login", null],
  ])("rejects %s as assignee", async (_l, user) => {
    p.user.findUnique.mockResolvedValue(user)
    expect(await createFollowUpTask(valid)).toEqual({ error: expect.stringContaining("staff member") })
    expect(p.followUpTask.create).not.toHaveBeenCalled()
  })

  it("rejects a bad date and an over-long title", async () => {
    expect(await createFollowUpTask({ ...valid, dueDate: "2026-02-30" })).toEqual({ error: "Enter a valid due date" })
    expect((await createFollowUpTask({ ...valid, title: "x".repeat(201) })) as { error: string }).toHaveProperty("error")
  })
})

describe("updateFollowUpTask", () => {
  const upd = (over: Record<string, unknown> = {}) =>
    ({ title: "Visit", notes: null, assigneeId: 9, dueDate: null, ...over }) as Parameters<typeof updateFollowUpTask>[1]

  beforeEach(() => {
    p.followUpTask.findFirst.mockResolvedValue({
      title: "enc:Visit",
      notes: null,
      assigneeId: 9,
      dueDate: null,
      personId: 3,
      familyId: null,
    })
  })

  it.each(NON_MANAGERS)("rejects role %s (assignees can't edit)", async (role) => {
    as(role, "9")
    expect(await updateFollowUpTask(1, upd({ title: "New" }))).toEqual({ error: "Unauthorized" })
    expect(p.followUpTask.updateMany).not.toHaveBeenCalled()
  })

  it("writes only changed fields and audits a reassignment", async () => {
    expect(await updateFollowUpTask(1, upd({ assigneeId: 12, dueDate: "2026-12-01" }))).toEqual({
      success: "Task saved",
    })
    expect(p.followUpTask.updateMany).toHaveBeenCalledWith({
      where: { id: 1, ...LIVE },
      data: { assigneeId: 12, dueDate: new Date("2026-12-01T00:00:00.000Z") },
    })
    expect(audit).toHaveBeenCalledWith(expect.anything(), 1, "FOLLOW_UP_UPDATED", "FollowUpTask", 1, {
      fields: ["assigneeId", "dueDate"],
      assigneeFrom: 9,
      assigneeTo: 12,
    })
  })

  it("rejects a partial update (omitting a field must not clear it)", async () => {
    expect(await updateFollowUpTask(1, { title: "New" } as Parameters<typeof updateFollowUpTask>[1])).toEqual({
      error: "Missing task fields",
    })
    expect(p.followUpTask.updateMany).not.toHaveBeenCalled()
  })

  it("is a no-op when nothing changed", async () => {
    expect(await updateFollowUpTask(1, upd())).toEqual({ success: "No changes" })
    expect(p.followUpTask.updateMany).not.toHaveBeenCalled()
  })

  it("answers Not found for a missing / archived-target task", async () => {
    p.followUpTask.findFirst.mockResolvedValue(null)
    expect(await updateFollowUpTask(1, upd({ title: "x" }))).toEqual({ error: "Not found" })
    expect(await updateFollowUpTask(-1, upd({ title: "x" }))).toEqual({ error: "Not found" })
  })

  it("never overwrites unreadable text with its placeholder", async () => {
    p.followUpTask.findFirst.mockResolvedValue({ title: "BROKEN", notes: null, assigneeId: 9, dueDate: null, personId: 3, familyId: null })
    expect(await updateFollowUpTask(1, upd({ title: "[decryption error]" }))).toEqual({
      error: expect.stringContaining("can't be read"),
    })
    expect(p.followUpTask.updateMany).not.toHaveBeenCalled()
  })
})

describe("setFollowUpStatus", () => {
  beforeEach(() => {
    p.followUpTask.findFirst.mockResolvedValue({ status: FollowUpStatus.OPEN, personId: 3, familyId: null })
  })

  it("lets the assignee complete their own task, scoped by assigneeId", async () => {
    as(UserRole.OFFICE_ADMIN, "9")
    expect(await setFollowUpStatus(1, FollowUpStatus.DONE)).toEqual({ success: "Status updated" })
    expect(p.followUpTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, assigneeId: 9, ...LIVE } }),
    )
    expect(p.followUpTask.updateMany).toHaveBeenCalledWith({
      where: { id: 1, assigneeId: 9, ...LIVE, status: FollowUpStatus.OPEN },
      data: { status: FollowUpStatus.DONE, completedAt: expect.any(Date), completedById: 9 },
    })
    expect(audit).toHaveBeenCalledWith(expect.anything(), 9, "FOLLOW_UP_STATUS_CHANGED", "FollowUpTask", 1, {
      from: FollowUpStatus.OPEN,
      to: FollowUpStatus.DONE,
    })
  })

  it("IDOR: a non-assignee gets Not found (scope matches no row)", async () => {
    as(UserRole.OFFICE_ADMIN, "8")
    p.followUpTask.findFirst.mockResolvedValue(null)
    expect(await setFollowUpStatus(1, FollowUpStatus.DONE)).toEqual({ error: "Not found" })
    expect(p.followUpTask.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1, assigneeId: 8, ...LIVE } }))
    expect(p.followUpTask.updateMany).not.toHaveBeenCalled()
  })

  it("a manager is unscoped, and reopening clears completion", async () => {
    p.followUpTask.findFirst.mockResolvedValue({ status: FollowUpStatus.DONE, personId: 3, familyId: null })
    await setFollowUpStatus(1, FollowUpStatus.OPEN)
    expect(p.followUpTask.updateMany).toHaveBeenCalledWith({
      where: { id: 1, ...LIVE, status: FollowUpStatus.DONE },
      data: { status: FollowUpStatus.OPEN, completedAt: null, completedById: null },
    })
  })

  it.each(NO_SCOPE)("rejects role %s", async (role) => {
    as(role)
    expect(await setFollowUpStatus(1, FollowUpStatus.DONE)).toEqual({ error: "Unauthorized" })
    expect(p.followUpTask.findFirst).not.toHaveBeenCalled()
  })

  it("reports a concurrent change (reassigned / status moved after the read)", async () => {
    p.followUpTask.updateMany.mockResolvedValue({ count: 0 })
    expect(await setFollowUpStatus(1, FollowUpStatus.DONE)).toEqual({ error: expect.stringContaining("changed") })
    expect(audit).not.toHaveBeenCalled()
  })

  it("rejects an unknown status", async () => {
    expect(await setFollowUpStatus(1, "NOPE" as FollowUpStatus)).toEqual({ error: "Not found" })
  })
})

describe("deleteFollowUpTask", () => {
  it.each(NON_MANAGERS)("rejects role %s", async (role) => {
    as(role)
    expect(await deleteFollowUpTask(1)).toEqual({ error: "Unauthorized" })
    expect(p.followUpTask.deleteMany).not.toHaveBeenCalled()
  })

  it("deletes and audits ids only", async () => {
    p.followUpTask.findUnique.mockResolvedValue({ personId: null, familyId: 4 })
    expect(await deleteFollowUpTask(1)).toEqual({ success: "Task deleted" })
    expect(audit).toHaveBeenCalledWith(expect.anything(), 1, "FOLLOW_UP_DELETED", "FollowUpTask", 1, {
      personId: null,
      familyId: 4,
    })
  })

  it("answers Not found for a missing task", async () => {
    p.followUpTask.findUnique.mockResolvedValue(null)
    expect(await deleteFollowUpTask(1)).toEqual({ error: "Not found" })
    expect(audit).not.toHaveBeenCalled()
  })
})

describe("listFollowUpTasks / getFollowUpTask", () => {
  it("managers list every live task, decrypted, with an overdue flag", async () => {
    const r = await listFollowUpTasks()
    expect(p.followUpTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ...LIVE }, take: 500 }))
    expect(r).toEqual({
      tasks: [
        expect.objectContaining({
          id: 1,
          title: "Visit",
          notes: "Bring card",
          dueDate: "2026-11-10",
          overdue: true,
          personName: "Sam Demo",
          assigneeName: "Office",
        }),
      ],
    })
  })

  it("an assignee's scope overrides a caller-supplied filter", async () => {
    as(UserRole.OFFICE_ADMIN, "9")
    await listFollowUpTasks({ statuses: [FollowUpStatus.OPEN], personId: 3 })
    expect(p.followUpTask.findMany.mock.calls[0][0].where).toEqual({
      ...LIVE,
      status: { in: [FollowUpStatus.OPEN] },
      personId: 3,
      assigneeId: 9,
    })
  })

  it("an all-invalid status filter matches nothing instead of everything", async () => {
    expect(await listFollowUpTasks({ statuses: ["NOPE" as FollowUpStatus] })).toEqual({ tasks: [] })
    expect(p.followUpTask.findMany).not.toHaveBeenCalled()
  })

  it("done tasks are never overdue", async () => {
    p.followUpTask.findMany.mockResolvedValue([row({ status: FollowUpStatus.DONE })])
    const r = (await listFollowUpTasks()) as { tasks: { overdue: boolean }[] }
    expect(r.tasks[0].overdue).toBe(false)
  })

  it.each(NO_SCOPE)("rejects role %s", async (role) => {
    as(role)
    expect(await listFollowUpTasks()).toEqual({ error: "Unauthorized" })
    expect(await getFollowUpTask(1)).toEqual({ error: "Unauthorized" })
    expect(p.followUpTask.findMany).not.toHaveBeenCalled()
  })

  it("getFollowUpTask is scoped (IDOR) and answers Not found", async () => {
    as(UserRole.OFFICE_ADMIN, "9")
    p.followUpTask.findFirst.mockResolvedValue(null)
    expect(await getFollowUpTask(1)).toEqual({ error: "Not found" })
    expect(p.followUpTask.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1, ...LIVE, assigneeId: 9 } }))
    p.followUpTask.findFirst.mockResolvedValue(row())
    expect(await getFollowUpTask(1)).toEqual({ task: expect.objectContaining({ id: 1, title: "Visit" }) })
  })
})

describe("countMyDueFollowUps", () => {
  it("counts the caller's own open tasks due by today (Sydney)", async () => {
    as(UserRole.OFFICE_ADMIN, "9")
    p.followUpTask.count.mockResolvedValue(2)
    expect(await countMyDueFollowUps()).toBe(2)
    expect(p.followUpTask.count).toHaveBeenCalledWith({
      where: {
        ...LIVE,
        assigneeId: 9,
        status: { in: [FollowUpStatus.OPEN, FollowUpStatus.IN_PROGRESS] },
        dueDate: { lte: new Date("2026-11-14T00:00:00.000Z") },
      },
    })
  })

  it("is 0 for roles that can't hold tasks", async () => {
    as(UserRole.AUDITOR)
    expect(await countMyDueFollowUps()).toBe(0)
    expect(p.followUpTask.count).not.toHaveBeenCalled()
  })
})
