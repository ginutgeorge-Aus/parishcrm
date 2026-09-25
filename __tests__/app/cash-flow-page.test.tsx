/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    transaction: { groupBy: jest.fn(), aggregate: jest.fn() },
    accountOpeningBalance: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}))
jest.mock("@/components/accounting/YearSelector", () => ({ YearSelector: () => null }))
jest.mock("@/components/ui/PrintButton", () => ({ PrintButton: () => null }))
// Single BANK account, id 1 — mirrors the "old" ANZ_CHURCH-only fixture below.
jest.mock("@/lib/paymentAccounts", () => ({
  getPaymentAccounts: jest.fn().mockResolvedValue([
    { id: 1, name: "ANZ Church", kind: "BANK", isDefault: true, isActive: true },
  ]),
}))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import CashFlowPage from "@/app/(dashboard)/accounting/reports/cash-flow/page"

const mockAuth = auth as jest.Mock
const mockFindMany = prisma.account.findMany as jest.Mock
const mockGroupBy = prisma.transaction.groupBy as jest.Mock
const mockAggregate = prisma.transaction.aggregate as jest.Mock
const mockObFindUnique = prisma.accountOpeningBalance.findUnique as jest.Mock

const makeAgg = (amount: string | null) => ({
  _sum: { amount: amount ? { toString: () => amount } : null },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockFindMany.mockResolvedValue([])
  mockGroupBy.mockResolvedValue([])
  mockAggregate.mockResolvedValue(makeAgg("0"))
})

const props = (year: string) => ({ searchParams: Promise.resolve({ year }) })

describe("CashFlowPage — mid-FY opening-balance anchor", () => {
  it("aggregates movement from the anchor date, not FY start, when anchored mid-FY", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    // ANZ_CHURCH anchored 2025-09-01 (mid FY 2025, which starts 2025-07-01).
    mockObFindUnique.mockImplementation(({ where }: { where: { paymentAccountId: number } }) =>
      where.paymentAccountId === 1
        ? Promise.resolve({ amount: { toString: () => "5000" }, asOfDate: new Date("2025-09-01") })
        : Promise.resolve(null)
    )

    await CashFlowPage(props("2025"))

    // Every movement aggregate for the anchored account must start at the anchor,
    // never at fyStart — else Jul–Aug movement (already in ob.amount) is counted twice.
    const churchCalls = mockAggregate.mock.calls.filter(
      ([arg]) => arg.where.paymentAccountId === 1
    )
    expect(churchCalls.length).toBeGreaterThan(0)
    for (const [arg] of churchCalls) {
      expect(arg.where.date.gte).toEqual(new Date("2025-09-01"))
    }
    // No pre-anchor movement query (that branch is only for anchor ≤ FY start).
    expect(
      churchCalls.some(([arg]) => arg.where.date.gte < new Date("2025-09-01"))
    ).toBe(false)
  })

  it("aggregates movement from FY start when anchored on/before FY start", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockImplementation(({ where }: { where: { paymentAccountId: number } }) =>
      where.paymentAccountId === 1
        ? Promise.resolve({ amount: { toString: () => "5000" }, asOfDate: new Date("2025-07-01") })
        : Promise.resolve(null)
    )

    await CashFlowPage(props("2025"))

    const churchGtes = mockAggregate.mock.calls
      .filter(([arg]) => arg.where.paymentAccountId === 1)
      .map(([arg]) => arg.where.date.gte as Date)
    // Movement window starts at FY start; no query before the anchor.
    expect(churchGtes).toContainEqual(new Date("2025-07-01"))
    expect(churchGtes.some((d) => d < new Date("2025-07-01"))).toBe(false)
  })

  // §8.4 — assert the rendered $ operating totals, not just the query
  // shape. cashIn/cashOut/netMovement are computed inline from the groupBy.
  it("sums Total closing cash in dollars, not 100× inflated", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    // One account with a $5,000 opening balance, no movement → closing $5,000.
    mockObFindUnique.mockImplementation(({ where }: { where: { paymentAccountId: number } }) =>
      where.paymentAccountId === 1
        ? Promise.resolve({ amount: { toString: () => "5000" }, asOfDate: new Date("2025-09-01") })
        : Promise.resolve(null)
    )
    const html = renderToStaticMarkup(await CashFlowPage(props("2025")))
    expect(html).toContain("Total closing cash")
    expect(html).toContain("$5,000.00")
    // p.closing is already integer cents; feeding it through sumCents/toCents
    // multiplied by 100 → $500,000.00. That must never appear.
    expect(html).not.toContain("$500,000.00")
  })

  it("renders Total cash in / out and Net cash movement ($3,000 − $1,000 = $2,000)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue([
      { id: 1, code: "100", name: "Tithes", isActive: true, type: "INCOME", group: { id: 1, name: "Giving", sortOrder: 1 } },
      { id: 2, code: "200", name: "Rent", isActive: true, type: "EXPENSE", group: { id: 2, name: "Property", sortOrder: 2 } },
    ])
    mockGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: { toString: () => "3000" } } },
      { accountId: 2, _sum: { amount: { toString: () => "1000" } } },
    ])
    const html = renderToStaticMarkup(await CashFlowPage(props("2025")))
    expect(html).toContain("Total cash in")
    expect(html).toContain("$3,000.00")
    expect(html).toContain("Total cash out")
    expect(html).toContain("$1,000.00")
    expect(html).toContain("Net cash movement")
    expect(html).toContain("$2,000.00")
  })

  // / — the XFER internal-transfer clearing account holds two
  // positive-amount legs (INCOME + EXPENSE); pulling it back into this
  // report's type-grouped `_sum.amount` would inflate Total Cash Out, just
  // like the P&L Total Expenses double-count.
  it("excludes the XFER account from the account.findMany where clause", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await CashFlowPage(props("2025"))
    const arg = mockFindMany.mock.calls[0][0]
    expect(arg.where.code).toEqual({ not: "XFER" })
  })
})
