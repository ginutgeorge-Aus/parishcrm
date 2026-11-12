/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    group: { findFirst: jest.fn() },
    groupMessage: { create: jest.fn() },
    groupMessageRecipient: { createMany: jest.fn() },
    groupLeaderAccess: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  }
  m.$transaction.mockImplementation((fn: (tx: typeof m) => unknown) => fn(m))
  return { prisma: m }
})
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("@/lib/dbRateLimit", () => ({ dbRateLimit: jest.fn() }))
jest.mock("@/lib/groupRecipients", () => ({ selectRecipients: jest.fn() }))
jest.mock("@/lib/groupMessageDeliver", () => ({ deliverGroupMessage: jest.fn() }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn() } }))
jest.mock("next/server", () => ({ after: jest.fn((fn: () => unknown) => fn()) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }) }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { selectRecipients } from "@/lib/groupRecipients"
import { deliverGroupMessage } from "@/lib/groupMessageDeliver"
import { sendGroupMessage } from "@/lib/actions/groupMessage"

const as = (role: UserRole | undefined) => (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "9", role } } : null)
const p = prisma as unknown as {
  group: { findFirst: jest.Mock }
  groupMessage: { create: jest.Mock }
  groupMessageRecipient: { createMany: jest.Mock }
  groupLeaderAccess: { findUnique: jest.Mock }
  $transaction: jest.Mock
}
const form = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}
const ok = form({ subject: "Hello", body: "Rehearsal at 7" })
const run = (id = 4, f = ok) => sendGroupMessage(id, undefined, f)

beforeEach(() => {
  jest.clearAllMocks()
  as(UserRole.ADMIN)
  p.group.findFirst.mockResolvedValue({ id: 4 })
  p.groupMessage.create.mockResolvedValue({ id: 70 })
  p.groupLeaderAccess.findUnique.mockResolvedValue({ id: 1 })
  ;(selectRecipients as jest.Mock).mockResolvedValue({ recipients: [{ personId: 1, name: "A" }, { personId: 2, name: "B" }], skipped: [{ personId: 3, name: "C", reason: "NO_CONSENT" }] })
  ;(dbRateLimit as jest.Mock).mockResolvedValue(true)
  ;(deliverGroupMessage as jest.Mock).mockResolvedValue({})
})

describe("sendGroupMessage", () => {
  it("queues the message + PENDING recipients + audit in one transaction, then drains and redirects", async () => {
    await expect(run()).rejects.toThrow("REDIRECT:/groups/4/messages")
    expect(p.$transaction).toHaveBeenCalledTimes(1)
    expect(p.groupMessage.create.mock.calls[0][0].data).toEqual({ groupId: 4, sentById: 9, subject: "Hello", body: "Rehearsal at 7" })
    expect(p.groupMessageRecipient.createMany).toHaveBeenCalledWith({ data: [{ messageId: 70, personId: 1 }, { messageId: 70, personId: 2 }] })
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 9, "GROUP_MESSAGE_SENT", "Group", 4, { messageId: 70, recipients: 2, skipped: 1 })
    expect(deliverGroupMessage).toHaveBeenCalledWith(70)
  })

  it("a failing immediate drain does not undo the queued message", async () => {
    ;(deliverGroupMessage as jest.Mock).mockRejectedValue(new Error("smtp down"))
    await expect(run()).rejects.toThrow("REDIRECT:/groups/4/messages")
    expect(p.groupMessage.create).toHaveBeenCalled()
  })

  it("rate limit: one send per group per 5 minutes; refusal writes nothing", async () => {
    ;(dbRateLimit as jest.Mock).mockResolvedValue(false)
    expect(await run()).toEqual({ error: expect.stringContaining("5 minutes") })
    expect(dbRateLimit).toHaveBeenCalledWith("group-message:4", 1, 5 * 60 * 1000)
    expect(p.$transaction).not.toHaveBeenCalled()
  })

  it("refuses when every member is opted out / has no address, without using the rate-limit slot", async () => {
    ;(selectRecipients as jest.Mock).mockResolvedValue({ recipients: [], skipped: [{ personId: 3, name: "C", reason: "NO_CONSENT" }] })
    expect(await run()).toEqual({ error: expect.stringContaining("No members can receive") })
    expect(dbRateLimit).not.toHaveBeenCalled()
  })

  it.each([
    ["empty subject", { subject: " ", body: "x" }],
    ["subject with newline", { subject: "a\nBcc: x", body: "x" }],
    ["empty body", { subject: "s", body: "" }],
    ["subject too long", { subject: "s".repeat(151), body: "x" }],
    ["body too long", { subject: "s", body: "x".repeat(10001) }],
  ])("rejects %s", async (_n, v) => {
    expect(await run(4, form(v))).toEqual({ error: expect.any(String) })
    expect(p.$transaction).not.toHaveBeenCalled()
  })

  it("unauthenticated and VIEWER are refused", async () => {
    as(undefined)
    expect(await run()).toEqual({ error: "Unauthorized" })
    as(UserRole.VIEWER)
    expect(await run()).toEqual({ error: "Unauthorized" })
    expect(p.$transaction).not.toHaveBeenCalled()
  })

  it("linked EVENT_ORGANISER may send and is sent to the portal history", async () => {
    as(UserRole.EVENT_ORGANISER)
    await expect(run()).rejects.toThrow("REDIRECT:/my-groups/4/messages")
    expect(p.groupLeaderAccess.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { groupId_userId: { groupId: 4, userId: 9 } } }))
  })

  it("IDOR: an organiser not linked to this group is refused", async () => {
    as(UserRole.EVENT_ORGANISER)
    p.groupLeaderAccess.findUnique.mockResolvedValue(null)
    expect(await run()).toEqual({ error: "Unauthorized" })
    expect(selectRecipients).not.toHaveBeenCalled()
    expect(p.$transaction).not.toHaveBeenCalled()
  })

  it("an archived or missing group is refused", async () => {
    p.group.findFirst.mockResolvedValue(null)
    expect(await run()).toEqual({ error: "Group not found" })
  })

  it("invalid group id is refused", async () => {
    expect(await run(-1)).toEqual({ error: "Invalid group" })
  })
})
