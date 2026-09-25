// src/lib/__tests__/usage.test.ts
jest.mock("@/lib/prisma", () => ({
  prisma: { auditLog: { groupBy: jest.fn(), count: jest.fn() } },
}))
import { prisma } from "@/lib/prisma"
import { getUsageSummary } from "@/lib/usage"

const groupBy = prisma.auditLog.groupBy as jest.Mock
const count = prisma.auditLog.count as jest.Mock

describe("getUsageSummary", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns adoption desc and dormant = canonical minus seen", async () => {
    // 1st groupBy call = adoption by resourceType; every later groupBy = weekly distinct users
    groupBy
      .mockResolvedValueOnce([
        { resourceType: "Person", _count: { _all: 5 } },
        { resourceType: "Event", _count: { _all: 9 } },
      ])
      .mockResolvedValue([{ userId: 1 }, { userId: 2 }]) // 2 distinct users each week
    count.mockResolvedValue(3)

    const s = await getUsageSummary(30, new Date("2026-09-01T00:00:00.000Z"))
    expect(s.adoption[0]).toEqual({ resourceType: "Event", count: 9 })
    expect(s.dormant).not.toContain("Person")
    expect(s.dormant).not.toContain("Event")
    expect(s.dormant).toContain("Budget")
    expect(s.weeklyTrend).toHaveLength(12)
    expect(s.weeklyActiveUsers[0]).toEqual({ label: expect.any(String), count: 2 })
  })
})
