/** @jest-environment node */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    transaction: { groupBy: jest.fn(), findMany: jest.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { currentFYYear } from "@/lib/fiscalYear"
import { getPLReportData, resolvePLYear } from "@/lib/reports/plQuery"

const mockAccountFindMany = prisma.account.findMany as jest.Mock
const mockTxGroupBy = prisma.transaction.groupBy as jest.Mock
const mockTxFindMany = prisma.transaction.findMany as jest.Mock

const dec = (v: string) => ({ toString: () => v })

const accounts = [
  { id: 1, code: "100", name: "Tithes", isActive: true, type: "INCOME", group: { id: 1, name: "Giving", sortOrder: 1 } },
  { id: 2, code: "200", name: "Rent", isActive: true, type: "EXPENSE", group: { id: 2, name: "Property", sortOrder: 2 } },
]

beforeEach(() => jest.clearAllMocks())

describe("resolvePLYear", () => {
  const fyNow = currentFYYear()

  it("passes an in-range year through", () => {
    expect(resolvePLYear("2025")).toBe(2025)
  })

  it("defaults to the current FY when the param is absent", () => {
    expect(resolvePLYear(undefined)).toBe(fyNow)
  })

  it("clamps a below-floor year to the current FY", () => {
    expect(resolvePLYear("1999")).toBe(fyNow)
  })

  it("clamps a far-future year to the current FY", () => {
    expect(resolvePLYear(String(fyNow + 11))).toBe(fyNow)
  })

  it("falls back to the current FY on a non-numeric param", () => {
    expect(resolvePLYear("garbage")).toBe(fyNow)
  })

  // parseInt("2024junk", 10) === 2024, an in-range value, so the old
  // code silently accepted a malformed year param instead of rejecting it.
  it("falls back to the current FY on a numeric-prefixed garbage param", () => {
    expect(resolvePLYear("2024junk")).toBe(fyNow)
  })
})

describe("getPLReportData", () => {
  it("sums annual totals from groupBy over an FY-range where (integer cents)", async () => {
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("3000") } },
      { accountId: 2, _sum: { amount: dec("1000") } },
    ])

    const data = await getPLReportData(2025, false)

    expect(mockTxGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["accountId"],
        where: { date: { gte: new Date("2025-07-01"), lt: new Date("2026-07-01") } },
        _sum: { amount: true },
      }),
    )
    expect(data.totalIncome).toBe(300000)
    expect(data.totalExpenses).toBe(100000)
    expect(data.net).toBe(200000)
    expect(data.totalMap.get(1)).toBe(300000)
  })

  it("buckets accounts into income and expense groups by type", async () => {
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([])

    const data = await getPLReportData(2025, false)

    expect(data.incomeGroups.map((g) => g.groupName)).toEqual(["Giving"])
    expect(data.expenseGroups.map((g) => g.groupName)).toEqual(["Property"])
    expect(data.incomeGroups[0].accounts).toHaveLength(1)
  })

  it("skips the monthly stream and returns empty monthly arrays in annual view", async () => {
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([])

    const data = await getPLReportData(2025, false)

    expect(mockTxFindMany).not.toHaveBeenCalled()
    expect(data.incomeMonthly).toEqual([])
    expect(data.expenseMonthly).toEqual([])
    expect(data.netMonthly).toEqual([])
  })

  it("streams FY transactions and folds per-account monthly cents in monthly view", async () => {
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("3000") } },
      { accountId: 2, _sum: { amount: dec("1000") } },
    ])
    mockTxFindMany.mockResolvedValue([
      { id: 1, accountId: 1, amount: dec("3000"), date: new Date("2025-08-15") },
      { id: 2, accountId: 2, amount: dec("1000"), date: new Date("2025-09-10") },
    ])

    const data = await getPLReportData(2025, true)

    expect(mockTxFindMany).toHaveBeenCalledTimes(1)
    expect(mockTxFindMany).toHaveBeenCalledWith({
      where: { date: { gte: new Date("2025-07-01"), lt: new Date("2026-07-01") } },
      select: { id: true, accountId: true, amount: true, date: true },
      orderBy: { id: "asc" },
      take: 5000,
    })
    // FY month index 1 = August (July = 0); income $3,000 lands there.
    expect(data.incomeMonthly[1]).toBe(300000)
    // FY month index 2 = September; expense $1,000.
    expect(data.expenseMonthly[2]).toBe(100000)
    expect(data.netMonthly[1]).toBe(300000)
    expect(data.netMonthly[2]).toBe(-100000)
  })

  it("excludes the XFER clearing account from the account query", async () => {
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([])

    await getPLReportData(2025, false)

    const arg = mockAccountFindMany.mock.calls[0][0]
    expect(arg.where.code).toEqual({ not: "XFER" })
  })
})
