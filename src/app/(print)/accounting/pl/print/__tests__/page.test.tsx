import { cleanup, render, screen } from "@testing-library/react"
import PLPrintPage from "../page"
import PLReportPage from "@/app/(dashboard)/accounting/reports/pl/page"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    transaction: { groupBy: jest.fn(), findMany: jest.fn() },
    appSetting: { findUnique: jest.fn() },
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
import { redirect } from "next/navigation"

const mockAuth = auth as jest.Mock
const mAccounts = prisma.account.findMany as jest.Mock
const mGroupBy = prisma.transaction.groupBy as jest.Mock
const mAppSetting = prisma.appSetting.findUnique as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

const dec = (v: string) => ({ toString: () => v })

// Same conceptual fixture rendered two different ways: the print route embeds
// each account's transactions directly, the dashboard page sums them via a
// separate groupBy query. Both must land on the same dollar totals.
const printAccounts = [
  { id: 1, code: "100", name: "Tithes", isActive: true, type: "INCOME", group: { id: 10, name: "Giving", sortOrder: 0 }, transactions: [{ amount: dec("3000.00"), date: new Date("2025-08-01") }] },
  { id: 3, code: "150", name: "Fundraising", isActive: true, type: "INCOME", group: { id: 11, name: "Outreach", sortOrder: 1 }, transactions: [{ amount: dec("500.00"), date: new Date("2025-09-01") }] },
  { id: 2, code: "400", name: "Rent", isActive: true, type: "EXPENSE", group: { id: 12, name: "Property", sortOrder: 2 }, transactions: [{ amount: dec("1000.00"), date: new Date("2025-08-15") }] },
  { id: 4, code: "410", name: "Electricity", isActive: true, type: "EXPENSE", group: { id: 13, name: "Utilities", sortOrder: 3 }, transactions: [{ amount: dec("300.00"), date: new Date("2025-09-15") }] },
]

const dashboardAccounts = printAccounts.map(({ id, code, name, isActive, type, group }) => ({
  id, code, name, isActive, type, group,
}))

const dashboardGroupBy = [
  { accountId: 1, _sum: { amount: dec("3000.00") } },
  { accountId: 3, _sum: { amount: dec("500.00") } },
  { accountId: 2, _sum: { amount: dec("1000.00") } },
  { accountId: 4, _sum: { amount: dec("300.00") } },
]

beforeEach(() => {
  jest.clearAllMocks()
  mAppSetting.mockResolvedValue(null)
})

const makeProps = (params: Record<string, string> = {}) => ({ searchParams: Promise.resolve(params) })

describe("PLPrintPage — auth guards", () => {
  it("redirects to /login when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(PLPrintPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/login")
  })

  it("redirects VIEWER to /", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    await expect(PLPrintPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })
})

describe("PLPrintPage — rendered dollar totals", () => {
  it("renders Total Income, Total Expenses, and Net Surplus/(Deficit) for fixture transactions", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    mAccounts.mockResolvedValue(printAccounts)
    const ui = await PLPrintPage(makeProps())
    render(ui)
    expect(screen.getByText("$3,500.00")).toBeInTheDocument() // Total Income (3000 + 500)
    expect(screen.getByText("$1,300.00")).toBeInTheDocument() // Total Expenses (1000 + 300)
    expect(screen.getByText("$2,200.00")).toBeInTheDocument() // Net Surplus (3500 - 1300)
  })
})

describe("PLPrintPage — distinct same-name groups", () => {
  it("does not merge two distinct groups that share a display name", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    // Two distinct INCOME groups (different ids) with the SAME name "Ministry".
    // Keyed by name they would merge into one block; keyed by id they render two.
    mAccounts.mockResolvedValue([
      { id: 1, code: "100", name: "Sunday School", isActive: true, type: "INCOME", group: { id: 20, name: "Ministry", sortOrder: 0 }, transactions: [{ amount: dec("100.00"), date: new Date("2025-08-01") }] },
      { id: 2, code: "110", name: "Youth", isActive: true, type: "INCOME", group: { id: 21, name: "Ministry", sortOrder: 1 }, transactions: [{ amount: dec("200.00"), date: new Date("2025-08-02") }] },
    ])
    const ui = await PLPrintPage(makeProps())
    render(ui)
    // Merged → one "Ministry" group header; unmerged → two.
    expect(screen.getAllByText("Ministry").length).toBe(2)
  })
})

describe("Screen vs print consistency", () => {
  it("renders identical Total Income / Total Expenses / Net Surplus figures on the dashboard page and the print route", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })

    mAccounts.mockResolvedValue(dashboardAccounts)
    mGroupBy.mockResolvedValue(dashboardGroupBy)
    const dashboardUi = await PLReportPage(makeProps())
    render(dashboardUi)
    // Dashboard annual view renders both a mobile card layout and a desktop
    // table — each figure appears twice, once per breakpoint.
    expect(screen.getAllByText("$3,500.00").length).toBeGreaterThan(0)
    expect(screen.getAllByText("$1,300.00").length).toBeGreaterThan(0)
    expect(screen.getAllByText("$2,200.00").length).toBeGreaterThan(0)
    cleanup()

    mAccounts.mockResolvedValue(printAccounts)
    const printUi = await PLPrintPage(makeProps())
    render(printUi)
    expect(screen.getByText("$3,500.00")).toBeInTheDocument()
    expect(screen.getByText("$1,300.00")).toBeInTheDocument()
    expect(screen.getByText("$2,200.00")).toBeInTheDocument()
  })
})
