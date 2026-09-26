jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    transaction: { groupBy: jest.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { loadFyAccountTotals } from "@/lib/reports/fyAccountTotals"

const findMany = prisma.account.findMany as jest.Mock
const groupBy = prisma.transaction.groupBy as jest.Mock

describe("loadFyAccountTotals", () => {
  const start = new Date("2025-07-01")
  const end = new Date("2026-07-01")

  it("excludes XFER, scopes to the FY and maps totals to cents", async () => {
    findMany.mockResolvedValue([{ id: 1 }, { id: 2 }])
    groupBy.mockResolvedValue([{ accountId: 1, _sum: { amount: 12.34 } }])

    const { accounts, totalFor } = await loadFyAccountTotals(start, end)

    expect(accounts).toEqual([{ id: 1 }, { id: 2 }])
    expect(totalFor(1)).toBe(1234)
    expect(totalFor(2)).toBe(0)
    expect(findMany.mock.calls[0][0].where.code).toEqual({ not: "XFER" })
    expect(groupBy.mock.calls[0][0].where).toEqual({ date: { gte: start, lt: end } })
  })
})
