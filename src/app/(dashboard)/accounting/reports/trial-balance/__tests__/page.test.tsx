import { render, screen } from "@testing-library/react"
import TrialBalancePage from "../page"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/components/accounting/YearSelector", () => ({ YearSelector: () => <div /> }))
jest.mock("@/lib/prisma", () => ({
  prisma: { account: { findMany: jest.fn() }, transaction: { groupBy: jest.fn() } },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const mockAuth = auth as jest.Mock
const mAccounts = prisma.account.findMany as jest.Mock
const mGroup = prisma.transaction.groupBy as jest.Mock

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
})

it("redirects VIEWER", async () => {
  mockAuth.mockResolvedValue({ user: { role: "VIEWER" } })
  await expect(TrialBalancePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT")
})

it("renders debit and credit accounts for AUDITOR", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
  const ui = await TrialBalancePage({ searchParams: Promise.resolve({ year: "2025" }) })
  render(ui)
  expect(screen.getByText("Tithes")).toBeInTheDocument()
  expect(screen.getByText("Utilities")).toBeInTheDocument()
  expect(screen.getByText("Net surplus / (deficit)")).toBeInTheDocument()
})

it("renders exact debit, credit, and net surplus totals for fixture accounts", async () => {
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
  const ui = await TrialBalancePage({ searchParams: Promise.resolve({ year: "2025" }) })
  render(ui)
  expect(screen.getByText("$2,000.00")).toBeInTheDocument() // total debit (expenses): 800 + 1200
  expect(screen.getByText("$5,300.00")).toBeInTheDocument() // total credit (income): 5000 + 300
  expect(screen.getByText("$3,300.00")).toBeInTheDocument() // net surplus: 5300 - 2000
})
