/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
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
import TrialBalancePage from "@/app/(dashboard)/accounting/reports/trial-balance/page"

const mockAuth = auth as jest.Mock
const mockAccountFindMany = prisma.account.findMany as jest.Mock
const mockTxGroupBy = prisma.transaction.groupBy as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

const makeProps = (params: Record<string, string> = {}) => ({
  searchParams: Promise.resolve(params),
})

const accounts = [
  { id: 1, code: "100", name: "Tithes", isActive: true, type: "INCOME", group: { id: 1, name: "Giving", sortOrder: 1 } },
  { id: 2, code: "200", name: "Rent", isActive: true, type: "EXPENSE", group: { id: 2, name: "Property", sortOrder: 2 } },
]

beforeEach(() => jest.clearAllMocks())

describe("TrialBalancePage", () => {
  it("redirects VIEWER to /", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    await expect(TrialBalancePage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })

  // / — the XFER internal-transfer clearing account must never be
  // pulled into the account.findMany result: its two positive-amount legs
  // (INCOME + EXPENSE) would double-count into Total Debit under this
  // report's type-grouped `_sum.amount`, exactly like the P&L bug.
  it("excludes the XFER account from the account.findMany where clause", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([])
    await TrialBalancePage(makeProps({ year: "2025" }))
    const arg = mockAccountFindMany.mock.calls[0][0]
    expect(arg.where.code).toEqual({ not: "XFER" })
  })

  it("renders correct Total Debit / Total Credit ($3,000 income, $1,000 expense)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindMany.mockResolvedValue(accounts)
    mockTxGroupBy.mockResolvedValue([
      { accountId: 1, _sum: { amount: { toString: () => "3000" } } },
      { accountId: 2, _sum: { amount: { toString: () => "1000" } } },
    ])
    const html = renderToStaticMarkup(await TrialBalancePage(makeProps({ year: "2025" })))
    expect(html).toContain("$3,000.00")
    expect(html).toContain("$1,000.00")
    expect(html).not.toContain("Internal Transfer")
  })
})
