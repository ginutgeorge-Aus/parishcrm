/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    budget: { findMany: jest.fn() },
    transaction: { groupBy: jest.fn() },
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("@/components/accounting/YearSelector", () => ({ YearSelector: () => null }))
jest.mock("@/components/ui/PrintButton", () => ({ PrintButton: () => null }))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import BudgetVsActualPage from "@/app/(dashboard)/accounting/reports/budget-vs-actual/page"

const mockAuth = auth as jest.Mock
const mockAccountFindMany = prisma.account.findMany as jest.Mock
const mockBudgetFindMany = prisma.budget.findMany as jest.Mock
const mockTxGroupBy = prisma.transaction.groupBy as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

const makeProps = (params: Record<string, string> = {}) => ({
  searchParams: Promise.resolve(params),
})

const dec = (v: string) => ({ toString: () => v })

const accounts = [
  { id: 1, code: "100", name: "Tithes", type: "INCOME", group: { id: 1, name: "Giving", sortOrder: 1 } },
  { id: 2, code: "200", name: "Rent", type: "EXPENSE", group: { id: 2, name: "Property", sortOrder: 2 } },
]

beforeEach(() => jest.clearAllMocks())

describe("BudgetVsActualPage", () => {
  it("redirects VIEWER to /", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    await expect(BudgetVsActualPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })

  it("allows AUDITOR to view", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockBudgetFindMany.mockResolvedValue([])
    mockTxGroupBy.mockResolvedValue([])
    const result = await BudgetVsActualPage(makeProps())
    expect(result).toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("aggregates actuals via transaction.groupBy with FY-range where", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockBudgetFindMany.mockResolvedValue([])
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("3000") } },
      { accountId: 2, _sum: { amount: dec("1000") } },
    ])
    const result = await BudgetVsActualPage(makeProps({ year: "2025" }))
    expect(result).toBeDefined()
    expect(mockTxGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["accountId"],
        where: { date: { gte: new Date("2025-07-01"), lt: new Date("2026-07-01") } },
        _sum: { amount: true },
      })
    )
  })

  it("calls account.findMany WITHOUT a transactions include", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockBudgetFindMany.mockResolvedValue([])
    mockTxGroupBy.mockResolvedValue([])
    await BudgetVsActualPage(makeProps())
    const arg = mockAccountFindMany.mock.calls[0][0]
    expect(arg.include).toEqual({ group: { select: { id: true, name: true, sortOrder: true } } })
    expect(arg.include.transactions).toBeUndefined()
  })

  it("includes inactive accounts that have FY transactions", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockBudgetFindMany.mockResolvedValue([])
    mockTxGroupBy.mockResolvedValue([])
    await BudgetVsActualPage(makeProps({ year: "2025" }))
    const arg = mockAccountFindMany.mock.calls[0][0]
    expect(arg.where).toEqual({
      code: { not: "XFER" },
      OR: [
        { isActive: true },
        { transactions: { some: { date: { gte: new Date("2025-07-01"), lt: new Date("2026-07-01") } } } },
        // also include accounts with a selected-year budget row.
        { budgets: { some: { year: 2025 } } },
      ],
    })
  })

  // / — XFER has no budget row, so showing its transfer-leg actuals
  // is noise; the type-grouped `_sum.amount` would also inflate Total
  // Expenses actual the same way it inflated P&L Total Expenses.
  it("excludes the XFER account from the account.findMany where clause", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockBudgetFindMany.mockResolvedValue([])
    mockTxGroupBy.mockResolvedValue([])
    await BudgetVsActualPage(makeProps({ year: "2025" }))
    const arg = mockAccountFindMany.mock.calls[0][0]
    expect(arg.where.code).toEqual({ not: "XFER" })
  })

  it("renders with budget + actual rows present", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockBudgetFindMany.mockResolvedValue([
      { accountId: 1, amount: dec("2500") },
      { accountId: 2, amount: dec("1200") },
    ])
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("3000") } },
      { accountId: 2, _sum: { amount: dec("1000") } },
    ])
    const result = await BudgetVsActualPage(makeProps({ year: "2025" }))
    expect(result).toBeDefined()
  })

  it("defaults actual to 0 for accounts absent from groupBy result", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockBudgetFindMany.mockResolvedValue([])
    mockTxGroupBy.mockResolvedValue([]) // no actuals
    const result = await BudgetVsActualPage(makeProps())
    expect(result).toBeDefined()
  })

  it("flags a line whose variance exceeds the default 10% threshold", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    // Tithes: budget 1000, actual 1200 = +20% variance, over the 10% default.
    mockBudgetFindMany.mockResolvedValue([
      { accountId: 1, amount: dec("1000") },
      { accountId: 2, amount: dec("1000") },
    ])
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("1200") } },
      { accountId: 2, _sum: { amount: dec("1000") } },
    ])
    const result = await BudgetVsActualPage(makeProps())
    const html = renderToStaticMarkup(result)
    expect(html).toContain("over variance threshold")
  })

  it("does not flag lines within the threshold", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    // Tithes: budget 1000, actual 1050 = +5% variance, under the 10% default.
    mockBudgetFindMany.mockResolvedValue([
      { accountId: 1, amount: dec("1000") },
      { accountId: 2, amount: dec("1000") },
    ])
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("1050") } },
      { accountId: 2, _sum: { amount: dec("1000") } },
    ])
    const result = await BudgetVsActualPage(makeProps())
    const html = renderToStaticMarkup(result)
    expect(html).not.toContain("over variance threshold")
  })

  // §8.4 — assert the rendered $ Net totals, not just query shape / flags.
  // netBudget/netActual/netVariance are computed inline from budget + groupBy.
  it("renders correct Net budget / actual / variance totals", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockBudgetFindMany.mockResolvedValue([
      { accountId: 1, amount: dec("2500") }, // income budget
      { accountId: 2, amount: dec("1200") }, // expense budget
    ])
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("3000") } }, // income actual
      { accountId: 2, _sum: { amount: dec("1000") } }, // expense actual
    ])
    const html = renderToStaticMarkup(await BudgetVsActualPage(makeProps({ year: "2025" })))
    // Net budget = 2500 − 1200 = 1300; Net actual = 3000 − 1000 = 2000; variance = +700.
    expect(html).toContain("$1,300.00")
    expect(html).toContain("$2,000.00")
    expect(html).toContain("+$700.00")
  })

  it("honors a custom ?threshold= query param", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    // +5% variance — flagged only once the threshold is lowered to 2%.
    mockBudgetFindMany.mockResolvedValue([
      { accountId: 1, amount: dec("1000") },
      { accountId: 2, amount: dec("1000") },
    ])
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("1050") } },
      { accountId: 2, _sum: { amount: dec("1000") } },
    ])
    const result = await BudgetVsActualPage(makeProps({ threshold: "2" }))
    const html = renderToStaticMarkup(result)
    expect(html).toContain("over variance threshold")
  })
})
