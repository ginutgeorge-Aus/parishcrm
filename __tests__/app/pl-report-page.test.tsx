/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    transaction: { groupBy: jest.fn(), findMany: jest.fn() },
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("@/components/accounting/YearSelector", () => ({ YearSelector: () => null }))
jest.mock("@/components/accounting/ViewToggle", () => ({ ViewToggle: () => null }))
jest.mock("@/components/ui/PrintButton", () => ({ PrintButton: () => null }))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import PLReportPage from "@/app/(dashboard)/accounting/reports/pl/page"

const mockAuth = auth as jest.Mock
const mockAccountFindMany = prisma.account.findMany as jest.Mock
const mockTxGroupBy = prisma.transaction.groupBy as jest.Mock
const mockTxFindMany = prisma.transaction.findMany as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

const makeProps = (params: Record<string, string> = {}) => ({
  searchParams: Promise.resolve(params),
})

const dec = (v: string) => ({ toString: () => v })

const accounts = [
  { id: 1, code: "100", name: "Tithes", isActive: true, type: "INCOME", group: { id: 1, name: "Giving", sortOrder: 1 } },
  { id: 2, code: "200", name: "Rent", isActive: true, type: "EXPENSE", group: { id: 2, name: "Property", sortOrder: 2 } },
]

beforeEach(() => jest.clearAllMocks())

describe("PLReportPage", () => {
  it("redirects VIEWER to /", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    await expect(PLReportPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })

  it("allows AUDITOR to view", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([])
    const result = await PLReportPage(makeProps())
    expect(result).toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("aggregates annual totals via transaction.groupBy with FY-range where", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("3000") } },
      { accountId: 2, _sum: { amount: dec("1000") } },
    ])
    const result = await PLReportPage(makeProps({ year: "2025" }))
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
    mockTxGroupBy.mockResolvedValue([])
    await PLReportPage(makeProps())
    const arg = mockAccountFindMany.mock.calls[0][0]
    expect(arg.include).toEqual({ group: { select: { id: true, name: true, sortOrder: true } } })
    expect(arg.include.transactions).toBeUndefined()
  })

  it("does NOT run the monthly flat query in annual view", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([])
    await PLReportPage(makeProps())
    expect(mockTxFindMany).not.toHaveBeenCalled()
  })

  it("streams the monthly view's FY transactions in keyset-paginated batches and renders", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("3000") } },
      { accountId: 2, _sum: { amount: dec("1000") } },
    ])
    mockTxFindMany.mockResolvedValue([
      { id: 1, accountId: 1, amount: dec("3000"), date: new Date("2025-08-15") },
      { id: 2, accountId: 2, amount: dec("1000"), date: new Date("2025-09-10") },
    ])
    const result = await PLReportPage(makeProps({ year: "2025", view: "monthly" }))
    expect(result).toBeDefined()
    // A short batch (2 rows < the 5000 batch size) terminates the stream after
    // the first page, so a single findMany here — now id-ordered, bounded by
    // `take`, and selecting `id` for the keyset cursor.
    expect(mockTxFindMany).toHaveBeenCalledTimes(1)
    expect(mockTxFindMany).toHaveBeenCalledWith({
      where: { date: { gte: new Date("2025-07-01"), lt: new Date("2026-07-01") } },
      select: { id: true, accountId: true, amount: true, date: true },
      orderBy: { id: "asc" },
      take: 5000,
    })
  })

  it("renders accounts present in OR-filter but absent from groupBy (zero total)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([]) // no transactions at all
    const result = await PLReportPage(makeProps())
    expect(result).toBeDefined()
  })

  // §8.4 — assert the rendered $ totals, not just the query shape. The
  // income/expense/net rollup is computed inline in the page (not a tested
  // helper), so exercise it end-to-end through the rendered markup.
  it("renders correct income / expense / net-surplus totals ($3,000 − $1,000 = $2,000)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("3000") } }, // INCOME
      { accountId: 2, _sum: { amount: dec("1000") } }, // EXPENSE
    ])
    const html = renderToStaticMarkup(await PLReportPage(makeProps({ year: "2025" })))
    expect(html).toContain("Total Income")
    expect(html).toContain("$3,000.00")
    expect(html).toContain("Total Expenses")
    expect(html).toContain("$1,000.00")
    expect(html).toContain("Net Surplus / (Deficit)")
    expect(html).toContain("$2,000.00")
  })

  it("renders a net DEFICIT in accounting parentheses when expenses exceed income", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("1000") } }, // INCOME
      { accountId: 2, _sum: { amount: dec("2500") } }, // EXPENSE
    ])
    const html = renderToStaticMarkup(await PLReportPage(makeProps({ year: "2025" })))
    expect(html).toContain("($1,500.00)") // net = 1,000 − 2,500
  })
})
