/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    sundaySchoolMessage: { create: jest.fn() },
    sundaySchoolMessageRecipient: { createMany: jest.fn() },
    rateLimit: { deleteMany: jest.fn() },
  }
  return { prisma: m }
})
jest.mock("@/lib/sundaySchoolYearLock", () => ({ withLiveClass: jest.fn() }))
jest.mock("@/lib/sundaySchoolAccess", () => ({ canMarkRoll: jest.fn() }))
jest.mock("@/lib/featureFlags", () => ({ featureGuard: jest.fn(async () => null) }))
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("@/lib/dbRateLimit", () => ({ dbRateLimit: jest.fn() }))
jest.mock("@/lib/sundaySchoolParents", () => ({ selectParentRecipients: jest.fn() }))
jest.mock("@/lib/sundaySchoolMessageDeliver", () => ({ deliverSsMessage: jest.fn() }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn() } }))
jest.mock("next/server", () => ({ after: jest.fn((fn: () => unknown) => fn()) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }) }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { featureGuard } from "@/lib/featureFlags"
import { canMarkRoll } from "@/lib/sundaySchoolAccess"
import { withLiveClass } from "@/lib/sundaySchoolYearLock"
import { selectParentRecipients } from "@/lib/sundaySchoolParents"
import { deliverSsMessage } from "@/lib/sundaySchoolMessageDeliver"
import { sendSsParentMessage } from "@/lib/actions/sundaySchoolMessage"

const as = (role: UserRole | undefined) => (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "9", role } } : null)
const p = prisma as unknown as {
  sundaySchoolMessage: { create: jest.Mock }
  sundaySchoolMessageRecipient: { createMany: jest.Mock }
  rateLimit: { deleteMany: jest.Mock }
}
const form = (o: { subject?: string; body?: string; studentIds?: string[] }) => {
  const f = new FormData()
  if (o.subject !== undefined) f.set("subject", o.subject)
  if (o.body !== undefined) f.set("body", o.body)
  for (const id of o.studentIds ?? []) f.append("studentId", id)
  return f
}
const ok = () => form({ subject: "No class Sunday", body: "See you next week", studentIds: ["1", "2"] })
const run = (id = 4, f = ok()) => sendSsParentMessage(id, undefined, f)

beforeEach(() => {
  jest.clearAllMocks()
  as(UserRole.ADMIN)
  ;(canMarkRoll as jest.Mock).mockResolvedValue(true)
  ;(featureGuard as jest.Mock).mockResolvedValue(null)
  ;(selectParentRecipients as jest.Mock).mockResolvedValue({
    students: 2, recipients: [{ personId: 10, name: "A" }, { personId: 11, name: "B" }], skipped: [{ personId: 2, name: "C", reason: "NO_PARENT" }],
  })
  ;(dbRateLimit as jest.Mock).mockResolvedValue(true)
  ;(deliverSsMessage as jest.Mock).mockResolvedValue({})
  ;(withLiveClass as jest.Mock).mockImplementation(async (_id: number, fn: (tx: unknown) => Promise<unknown>) => ({ live: true, value: await fn(prisma) }))
  p.sundaySchoolMessage.create.mockResolvedValue({ id: 70 })
  p.rateLimit.deleteMany.mockResolvedValue({ count: 1 })
})

describe("sendSsParentMessage", () => {
  it("queues message + recipients + audit inside the live-class transaction, drains, redirects (staff)", async () => {
    await expect(run()).rejects.toThrow("REDIRECT:/sunday-school/4/message?sent=1")
    expect(selectParentRecipients).toHaveBeenCalledWith(4, [1, 2])
    expect(withLiveClass).toHaveBeenCalledWith(4, expect.any(Function))
    expect(p.sundaySchoolMessage.create.mock.calls[0][0].data).toEqual({ classId: 4, sentById: 9, subject: "No class Sunday", body: "See you next week" })
    expect(p.sundaySchoolMessageRecipient.createMany).toHaveBeenCalledWith({ data: [{ messageId: 70, personId: 10 }, { messageId: 70, personId: 11 }] })
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 9, "SS_PARENT_MESSAGE_SENT", "SundaySchoolClass", 4, { messageId: 70, students: 2, recipients: 2, skipped: 1 })
    expect(JSON.stringify((logAuditTx as jest.Mock).mock.calls[0])).not.toContain("@")
    expect(deliverSsMessage).toHaveBeenCalledWith(70)
  })

  it("an assigned teacher is redirected to the volunteer portal", async () => {
    as(UserRole.TEACHER)
    await expect(run()).rejects.toThrow("REDIRECT:/my-classes/4/message?sent=1")
  })

  it.each([UserRole.VIEWER, UserRole.AUDITOR, undefined])("refuses role %s before any lookup", async (role) => {
    as(role)
    expect(await run()).toEqual({ error: "Unauthorized" })
    expect(canMarkRoll).not.toHaveBeenCalled()
    expect(withLiveClass).not.toHaveBeenCalled()
  })

  it("refuses a teacher not assigned to the class", async () => {
    as(UserRole.TEACHER)
    ;(canMarkRoll as jest.Mock).mockResolvedValue(false)
    expect(await run()).toEqual({ error: "Unauthorized" })
    expect(selectParentRecipients).not.toHaveBeenCalled()
  })

  it("refuses an invalid class id", async () => {
    expect(await run(0)).toEqual({ error: "Invalid class" })
  })

  it("refuses while the Sunday School feature is off", async () => {
    ;(featureGuard as jest.Mock).mockResolvedValue({ error: "off" })
    expect(await run()).toEqual({ error: "off" })
  })

  it.each([
    ["oversize subject", { subject: "x".repeat(201), body: "b", studentIds: ["1"] }, "Subject must be 200"],
    ["oversize body", { subject: "s", body: "x".repeat(10001), studentIds: ["1"] }, "Message must be 10000"],
    ["multi-line subject", { subject: "a\nb", body: "b", studentIds: ["1"] }, "single line"],
    ["no children", { subject: "s", body: "b", studentIds: [] }, "Select at least one child"],
    ["bad child id", { subject: "s", body: "b", studentIds: ["abc"] }, "Invalid child"],
    ["out-of-range child id", { subject: "s", body: "b", studentIds: ["9999999999"] }, "Invalid child"],
  ])("rejects %s server-side", async (_n, input, msg) => {
    expect(await run(4, form(input))).toEqual({ error: expect.stringContaining(msg) })
    expect(withLiveClass).not.toHaveBeenCalled()
  })

  it("accepts a 200-char subject and a 10,000-char body (CRLF counted as one)", async () => {
    const body = "a\r\n".repeat(3333) + "a"
    await expect(run(4, form({ subject: "x".repeat(200), body, studentIds: ["1"] }))).rejects.toThrow("REDIRECT")
  })

  it("refuses when no selected child has a reachable parent", async () => {
    ;(selectParentRecipients as jest.Mock).mockResolvedValue({ students: 1, recipients: [], skipped: [{ personId: 2, name: "C", reason: "NO_PARENT" }] })
    expect(await run()).toEqual({ error: expect.stringContaining("parent who can receive email") })
    expect(dbRateLimit).not.toHaveBeenCalled()
  })

  it("refuses when none of the ids is a child in this class", async () => {
    ;(selectParentRecipients as jest.Mock).mockResolvedValue({ students: 0, recipients: [], skipped: [] })
    expect(await run()).toEqual({ error: expect.stringContaining("Select at least one child") })
  })

  it("rate limit: one send per class per 5 minutes", async () => {
    ;(dbRateLimit as jest.Mock).mockResolvedValue(false)
    expect(await run()).toEqual({ error: expect.stringContaining("5 minutes") })
    expect(dbRateLimit).toHaveBeenCalledWith("ss-message:4", 1, 5 * 60 * 1000)
    expect(withLiveClass).not.toHaveBeenCalled()
  })

  it("refuses a locked (rolled-over) year and gives the send slot back", async () => {
    ;(withLiveClass as jest.Mock).mockResolvedValue({ live: false, error: "This school year is locked — it can no longer be changed" })
    expect(await run()).toEqual({ error: expect.stringContaining("locked") })
    expect(p.rateLimit.deleteMany).toHaveBeenCalledWith({ where: { key: "ss-message:4" } })
    expect(deliverSsMessage).not.toHaveBeenCalled()
  })

  it("releases the slot and rethrows when the queue transaction fails", async () => {
    ;(withLiveClass as jest.Mock).mockRejectedValue(new Error("db down"))
    await expect(run()).rejects.toThrow("db down")
    expect(p.rateLimit.deleteMany).toHaveBeenCalledWith({ where: { key: "ss-message:4" } })
  })

  it("a failing immediate drain does not undo the queued message", async () => {
    ;(deliverSsMessage as jest.Mock).mockRejectedValue(new Error("smtp down"))
    await expect(run()).rejects.toThrow("REDIRECT")
    expect(p.sundaySchoolMessage.create).toHaveBeenCalled()
  })
})
