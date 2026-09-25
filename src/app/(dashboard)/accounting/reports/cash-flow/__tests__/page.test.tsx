import { render, screen } from "@testing-library/react"
import CashFlowPage from "../page"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/components/accounting/YearSelector", () => ({ YearSelector: () => <div /> }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    transaction: { groupBy: jest.fn(), aggregate: jest.fn() },
    accountOpeningBalance: { findUnique: jest.fn() },
  },
}))
// 3 payment accounts — mirrors the "old" hardcoded ANZ_CHURCH/ANZ_TITHE/
// PETTY_CASH triad so the "3 amber notes" assertion below still holds.
jest.mock("@/lib/paymentAccounts", () => ({
  getPaymentAccounts: jest.fn().mockResolvedValue([
    { id: 1, name: "ANZ Church", kind: "BANK", isDefault: true, isActive: true },
    { id: 2, name: "ANZ Tithe", kind: "BANK", isDefault: false, isActive: true },
    { id: 3, name: "Petty Cash", kind: "CASH", isDefault: false, isActive: true },
  ]),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const mockAuth = auth as jest.Mock
const mAccounts = prisma.account.findMany as jest.Mock
const mGroup = prisma.transaction.groupBy as jest.Mock
const mAgg = prisma.transaction.aggregate as jest.Mock
const mOb = prisma.accountOpeningBalance.findUnique as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mAccounts.mockResolvedValue([
    { id: 1, code: "200", name: "Tithes", type: "INCOME", group: { id: 1, name: "Offerings", sortOrder: 0 } },
    { id: 2, code: "410", name: "Utilities", type: "EXPENSE", group: { id: 2, name: "Overheads", sortOrder: 1 } },
  ])
  mGroup.mockResolvedValue([
    { accountId: 1, _sum: { amount: "12400.00" } },
    { accountId: 2, _sum: { amount: "1230.00" } },
  ])
  mAgg.mockResolvedValue({ _sum: { amount: "0" } })
  mOb.mockResolvedValue(null) // no opening balances → amber notes, opening "—"
})

it("redirects VIEWER", async () => {
  mockAuth.mockResolvedValue({ user: { role: "VIEWER" } })
  await expect(CashFlowPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT")
})

it("renders operating activities + net movement for AUDITOR", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
  const ui = await CashFlowPage({ searchParams: Promise.resolve({ year: "2025" }) })
  render(ui)
  expect(screen.getByText("Net cash movement")).toBeInTheDocument()
  expect(screen.getByText("Offerings")).toBeInTheDocument()
  // one amber note per PaymentAccount with no opening balance (3 accounts)
  expect(screen.getAllByText(/has no opening balance set/i)).toHaveLength(3)
})

it("renders exact cash-in, cash-out, and net cash movement totals for fixture accounts", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mAccounts.mockResolvedValue([
    { id: 1, code: "100", name: "Tithes", type: "INCOME", group: { id: 1, name: "Offerings", sortOrder: 0 } },
    { id: 3, code: "150", name: "Fundraising", type: "INCOME", group: { id: 2, name: "Special", sortOrder: 1 } },
    { id: 2, code: "400", name: "Utilities", type: "EXPENSE", group: { id: 3, name: "Overheads", sortOrder: 2 } },
    { id: 4, code: "410", name: "Rent", type: "EXPENSE", group: { id: 4, name: "Property", sortOrder: 3 } },
  ])
  mGroup.mockResolvedValue([
    { accountId: 1, _sum: { amount: "5000.00" } },
    { accountId: 3, _sum: { amount: "300.00" } },
    { accountId: 2, _sum: { amount: "800.00" } },
    { accountId: 4, _sum: { amount: "1200.00" } },
  ])
  const ui = await CashFlowPage({ searchParams: Promise.resolve({ year: "2025" }) })
  render(ui)
  expect(screen.getByText("$5,300.00")).toBeInTheDocument() // total cash in: 5000 + 300
  expect(screen.getByText("$2,000.00")).toBeInTheDocument() // total cash out: 800 + 1200
  expect(screen.getByText("$3,300.00")).toBeInTheDocument() // net cash movement: 5300 - 2000
})
