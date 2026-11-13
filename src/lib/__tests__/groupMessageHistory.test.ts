/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({
  prisma: { groupMessage: { findMany: jest.fn() }, groupMessageRecipient: { groupBy: jest.fn(), findMany: jest.fn() } },
}))

import { prisma } from "@/lib/prisma"
import { loadGroupMessageHistory, STATUS_LABELS } from "@/lib/groupMessageHistory"

const db = prisma as unknown as {
  groupMessage: { findMany: jest.Mock }
  groupMessageRecipient: { groupBy: jest.Mock; findMany: jest.Mock }
}
const findMany = db.groupMessage.findMany
const groupBy = db.groupMessageRecipient.groupBy
const detailFindMany = db.groupMessageRecipient.findMany

describe("loadGroupMessageHistory", () => {
  beforeEach(() => jest.clearAllMocks())

  it("queries newest first, one extra row to detect an older page, scoped to the group", async () => {
    findMany.mockResolvedValue([])
    expect(await loadGroupMessageHistory(4)).toEqual({ messages: [], nextBefore: null })
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { groupId: 4 }, orderBy: { id: "desc" }, take: 21 })
  })

  it("applies the older-messages cursor and returns nextBefore when more exist", async () => {
    const createdAt = new Date("2026-11-13T00:00:00Z")
    const rows = Array.from({ length: 21 }, (_v, i) => ({ id: 100 - i, subject: "S", body: "B", createdAt, sentBy: { name: "Pat" } }))
    findMany.mockResolvedValue(rows)
    groupBy.mockResolvedValue([])
    detailFindMany.mockResolvedValue([])
    const r = await loadGroupMessageHistory(4, 500)
    expect(findMany.mock.calls[0][0].where).toEqual({ groupId: 4, id: { lt: 500 } })
    expect(r.messages).toHaveLength(20)
    expect(r.nextBefore).toBe(81)
  })

  it("tallies via a grouped count, lists only non-SENT recipients, and falls back for a removed sender", async () => {
    const createdAt = new Date("2026-11-13T00:00:00Z")
    findMany.mockResolvedValue([
      { id: 1, subject: "Hi", body: "Body", createdAt, sentBy: null },
      { id: 2, subject: "S", body: "B", createdAt, sentBy: { name: "Pat" } },
    ])
    groupBy.mockResolvedValue([
      { messageId: 1, status: "SENT", _count: { _all: 2 } },
      { messageId: 1, status: "FAILED", _count: { _all: 1 } },
    ])
    detailFindMany.mockResolvedValue([{ messageId: 1, status: "FAILED", person: { id: 3, firstName: "Cy", lastName: "Ode" } }])
    const { messages: [a, b], nextBefore } = await loadGroupMessageHistory(4)
    expect(nextBefore).toBeNull()
    expect(detailFindMany.mock.calls[0][0].where).toEqual({ messageId: { in: [1, 2] }, status: { not: "SENT" } })
    expect(a.sentBy).toBe("Removed user")
    expect(a.counts).toEqual({ SENT: 2, FAILED: 1 })
    expect(a.recipients).toEqual([{ personId: 3, name: "Cy Ode", status: "FAILED" }])
    expect(b).toMatchObject({ sentBy: "Pat", counts: {}, recipients: [] })
  })

  it("has plain labels for every status", () => {
    expect(STATUS_LABELS).toEqual({ PENDING: "Queued", SENT: "Sent", FAILED: "Failed", UNKNOWN: "Unconfirmed" })
  })
})
