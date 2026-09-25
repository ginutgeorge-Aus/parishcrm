/** @jest-environment node */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    budget: { findMany: jest.fn() },
    transaction: { groupBy: jest.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { currentFYYear } from "@/lib/fiscalYear"
import { getBudgetVsActualData, resolveBudgetYear } from "@/lib/reports/budgetVsActualQuery"

const mockAccountFindMany = prisma.account.findMany as jest.Mock
const mockBudgetFindMany = prisma.budget.findMany as jest.Mock
const mockTxGroupBy = prisma.transaction.groupBy as jest.Mock

const dec = (v: string) => ({ toString: () => v })

const accounts = [
  { id: 1, code: "100", name: "Tithes", type: "INCOME", group: { id: 1, name: "Giving", sortOrder: 1 } },
  { id: 2, code: "200", name: "Rent", type: "EXPENSE", group: { id: 2, name: "Property", sortOrder: 2 } },
]

beforeEach(() => jest.clearAllMocks())

describe("resolveBudgetYear", () => {
  const fyNow = currentFYYear()

  it("passes an in-range year through", () => {
    expect(resolveBudgetYear("2025")).toBe(2025)
  })

  it("defaults to the current FY when absent", () => {
    expect(resolveBudgetYear(undefined)).toBe(fyNow)
  })

  it("clamps out-of-range years to the current FY", () => {
    expect(resolveBudgetYear("1999")).toBe(fyNow)
    expect(resolveBudgetYear("2101")).toBe(fyNow)
    expect(resolveBudgetYear("garbage")).toBe(fyNow)
  })
})

describe("getBudgetVsActualData", () => {
  it("fetches actuals via groupBy over an FY-range where and excludes XFER", async () => {
    mockAccountFindMany.mockResolvedValue(accounts)
    mockBudgetFindMany.mockResolvedValue([])
    mockTxGroupBy.mockResolvedValue([])

    await getBudgetVsActualData(2025)

    expect(mockTxGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["accountId"],
        where: { date: { gte: new Date("2025-07-01"), lt: new Date("2026-07-01") } },
        _sum: { amount: true },
      }),
    )
    const accArg = mockAccountFindMany.mock.calls[0][0]
    expect(accArg.where.code).toEqual({ not: "XFER" })
    expect(accArg.include.transactions).toBeUndefined()
    expect(mockBudgetFindMany).toHaveBeenCalledWith({
      where: { year: 2025 },
      select: { accountId: true, amount: true, note: true },
    })
  })

  // (HIGH): an inactive account with a budget row for the selected
  // year but no transaction that year was excluded entirely — the account
  // OR filter only widened for actuals, not budgets — hiding its budgeted
  // amount from the income/expense totals.
  it("account OR filter includes accounts with a selected-year budget, not just actuals", async () => {
    mockAccountFindMany.mockResolvedValue(accounts)
    mockBudgetFindMany.mockResolvedValue([])
    mockTxGroupBy.mockResolvedValue([])

    await getBudgetVsActualData(2025)

    const accArg = mockAccountFindMany.mock.calls[0][0]
    expect(accArg.where.OR).toContainEqual({ budgets: { some: { year: 2025 } } })
  })

  it("rolls budget + actual into income/expense groups with Net totals and variances", async () => {
    mockAccountFindMany.mockResolvedValue(accounts)
    mockBudgetFindMany.mockResolvedValue([
      { accountId: 1, amount: dec("2500"), note: null }, // income budget
      { accountId: 2, amount: dec("1200"), note: null }, // expense budget
    ])
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("3000") } }, // income actual
      { accountId: 2, _sum: { amount: dec("1000") } }, // expense actual
    ])

    const data = await getBudgetVsActualData(2025)

    expect(data.incomeGroups.map((g) => g.groupName)).toEqual(["Giving"])
    expect(data.expenseGroups.map((g) => g.groupName)).toEqual(["Property"])
    expect(data.totalIncomeBudget).toBe(2500)
    expect(data.totalIncomeActual).toBe(3000)
    expect(data.totalExpenseBudget).toBe(1200)
    expect(data.totalExpenseActual).toBe(1000)
    // Net budget = 2500 − 1200 = 1300; Net actual = 3000 − 1000 = 2000; variance = +700.
    expect(data.netBudget).toBe(1300)
    expect(data.netActual).toBe(2000)
    expect(data.netVariance).toBe(700)
    expect(data.incomeVariance).toBe(500)
    expect(data.expenseVariance).toBe(-200)
  })

  it("defaults actual to 0 and budget to null for accounts absent from the maps", async () => {
    mockAccountFindMany.mockResolvedValue(accounts)
    mockBudgetFindMany.mockResolvedValue([]) // no budgets
    mockTxGroupBy.mockResolvedValue([]) // no actuals

    const data = await getBudgetVsActualData(2025)

    expect(data.incomeGroups[0].accounts[0].actual).toBe(0)
    expect(data.incomeGroups[0].accounts[0].budget).toBeNull()
    expect(data.totalIncomeActual).toBe(0)
    expect(data.netBudget).toBe(0)
  })
})
