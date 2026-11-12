/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({ prisma: { groupMessage: { findMany: jest.fn() } } }))

import { prisma } from "@/lib/prisma"
import { loadGroupMessageHistory, STATUS_LABELS } from "@/lib/groupMessageHistory"

const findMany = (prisma as unknown as { groupMessage: { findMany: jest.Mock } }).groupMessage.findMany

describe("loadGroupMessageHistory", () => {
  beforeEach(() => jest.clearAllMocks())

  it("queries newest first, capped, scoped to the group", async () => {
    findMany.mockResolvedValue([])
    expect(await loadGroupMessageHistory(4)).toEqual([])
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { groupId: 4 }, orderBy: { id: "desc" }, take: 50 })
  })

  it("maps names, tallies statuses and falls back for a removed sender", async () => {
    const createdAt = new Date("2026-11-13T00:00:00Z")
    findMany.mockResolvedValue([
      {
        id: 1, subject: "Hi", body: "Body", createdAt, sentBy: null,
        recipients: [
          { status: "SENT", person: { id: 1, firstName: "Ann", lastName: "Lee" } },
          { status: "SENT", person: { id: 2, firstName: "Bob", lastName: "Ng" } },
          { status: "FAILED", person: { id: 3, firstName: "Cy", lastName: "Ode" } },
        ],
      },
      { id: 2, subject: "S", body: "B", createdAt, sentBy: { name: "Pat" }, recipients: [] },
    ])
    const [a, b] = await loadGroupMessageHistory(4)
    expect(a.sentBy).toBe("Removed user")
    expect(a.counts).toEqual({ SENT: 2, FAILED: 1 })
    expect(a.recipients[0]).toEqual({ personId: 1, name: "Ann Lee", status: "SENT" })
    expect(b).toMatchObject({ sentBy: "Pat", counts: {}, recipients: [] })
  })

  it("has plain labels for every status", () => {
    expect(STATUS_LABELS).toEqual({ PENDING: "Queued", SENT: "Sent", FAILED: "Failed", UNKNOWN: "Unconfirmed" })
  })
})
