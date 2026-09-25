import { render, screen } from "@testing-library/react"
import PLReportPage from "../page"

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

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const mockAuth = auth as jest.Mock
const mAccounts = prisma.account.findMany as jest.Mock
const mGroupBy = prisma.transaction.groupBy as jest.Mock
const mFindMany = prisma.transaction.findMany as jest.Mock

const dec = (v: string) => ({ toString: () => v })

// Two accounts per section so a section total is never numerically equal to
// any single account/group figure — every assertion below targets a unique
// rendered string.
const accounts = [
  { id: 1, code: "100", name: "Tithes", isActive: true, type: "INCOME", group: { id: 1, name: "Giving", sortOrder: 0 } },
  { id: 3, code: "150", name: "Fundraising", isActive: true, type: "INCOME", group: { id: 2, name: "Outreach", sortOrder: 1 } },
  { id: 2, code: "400", name: "Utilities", isActive: true, type: "EXPENSE", group: { id: 3, name: "Overheads", sortOrder: 2 } },
  { id: 4, code: "410", name: "Rent", isActive: true, type: "EXPENSE", group: { id: 4, name: "Property", sortOrder: 3 } },
]

beforeEach(() => {
  jest.clearAllMocks()
  mAccounts.mockResolvedValue(accounts)
  mGroupBy.mockResolvedValue([
    { accountId: 1, _sum: { amount: dec("5000.00") } },
    { accountId: 3, _sum: { amount: dec("300.00") } },
    { accountId: 2, _sum: { amount: dec("800.00") } },
    { accountId: 4, _sum: { amount: dec("1200.00") } },
  ])
})

describe("PLReportPage — rendered dollar totals", () => {
  it("renders Total Income, Total Expenses, and Net Surplus/(Deficit) for fixture transactions", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const ui = await PLReportPage({ searchParams: Promise.resolve({}) })
    render(ui)
    // Annual view renders both a mobile card layout and a desktop table
    // — each figure appears twice, once per breakpoint.
    expect(screen.getAllByText("$5,300.00").length).toBeGreaterThan(0) // Total Income (5000 + 300)
    expect(screen.getAllByText("$2,000.00").length).toBeGreaterThan(0) // Total Expenses (800 + 1200)
    expect(screen.getAllByText("$3,300.00").length).toBeGreaterThan(0) // Net Surplus (5300 - 2000)
  })

  it("renders a negative net as a parenthesised accounting figure when expenses exceed income", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: dec("100.00") } },
      { accountId: 2, _sum: { amount: dec("900.00") } },
    ])
    const ui = await PLReportPage({ searchParams: Promise.resolve({}) })
    render(ui)
    // Rendered once in the mobile card layout and once in the desktop table.
    expect(screen.getAllByText("($800.00)").length).toBeGreaterThan(0) // net = 100 - 900
  })
})

describe("PLReportPage — monthly view streams FY transactions", () => {
  it("buckets streamed transactions into the correct FY month column", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    // One July tx (getUTCMonth()=6 => FY index 0 => JUL column) for account 1
    // (Tithes). $1,234.00 is distinct from every groupBy annual total so the
    // assertion targets only the monthly Jul cell populated by the stream.
    mFindMany.mockResolvedValue([
      { id: 1, accountId: 1, amount: dec("1234.00"), date: new Date("2025-07-15T00:00:00Z") },
    ])
    const ui = await PLReportPage({ searchParams: Promise.resolve({ view: "monthly" }) })
    render(ui)
    expect(mFindMany).toHaveBeenCalled()
    // JUL cell for Tithes + the group/section rollups it feeds all render $1,234.00.
    expect(screen.getAllByText("$1,234.00").length).toBeGreaterThan(0)
  })

  it("does not query transaction rows at all in the annual view", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const ui = await PLReportPage({ searchParams: Promise.resolve({}) })
    render(ui)
    expect(mFindMany).not.toHaveBeenCalled()
  })
})
