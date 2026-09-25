import { render, screen, within } from "@testing-library/react"
import GeneralLedgerPage from "../page"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: (s: string) => s }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    transaction: { findMany: jest.fn() },
  },
}))
// Client control stubbed to avoid next/navigation router hooks under test.
jest.mock("@/components/accounting/GeneralLedgerControls", () => ({
  GeneralLedgerControls: () => <div data-testid="gl-controls" />,
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const mockAuth = auth as jest.Mock
const mAccounts = prisma.account.findMany as jest.Mock
const mTx = prisma.transaction.findMany as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mAccounts.mockResolvedValue([{ id: 1, code: "200", name: "Tithes" }])
})

it("redirects VIEWER", async () => {
  mockAuth.mockResolvedValue({ user: { role: "VIEWER" } })
  await expect(GeneralLedgerPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT")
})

it("prompts to select an account when none chosen (AUDITOR)", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
  mTx.mockResolvedValue([])
  const ui = await GeneralLedgerPage({ searchParams: Promise.resolve({}) })
  render(ui)
  expect(screen.getByText(/select an account to view its ledger/i)).toBeInTheDocument()
})

it("renders ledger rows with running balance for a selected account", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mTx.mockResolvedValue([
    { date: new Date("2025-07-01"), description: "Sunday collection", reference: "DEP1", type: "INCOME", amount: "100.00" },
    { date: new Date("2025-07-08"), description: "Candles", reference: null, type: "EXPENSE", amount: "40.00" },
  ])
  const ui = await GeneralLedgerPage({ searchParams: Promise.resolve({ account: "1", year: "2025" }) })
  render(ui)
  const table = screen.getByRole("table")
  expect(within(table).getByText("Sunday collection")).toBeInTheDocument()
  expect(within(table).getByText("Candles")).toBeInTheDocument()
})

it("renders exact amount and running-balance dollar figures across mixed transactions", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mTx.mockResolvedValue([
    { date: new Date("2025-07-01"), description: "Sunday collection", reference: "DEP1", type: "INCOME", amount: "250.00" },
    { date: new Date("2025-07-08"), description: "Candles", reference: null, type: "EXPENSE", amount: "40.00" },
    { date: new Date("2025-07-15"), description: "Midweek offering", reference: "DEP2", type: "INCOME", amount: "100.00" },
  ])
  const ui = await GeneralLedgerPage({ searchParams: Promise.resolve({ account: "1", year: "2025" }) })
  render(ui)
  const table = screen.getByRole("table")
  // Amount column: signed per-transaction figure.
  expect(within(table).getByText("-$40.00")).toBeInTheDocument()
  expect(within(table).getByText("$100.00")).toBeInTheDocument()
  // Running balance column: cumulative (250 -> 210 -> 310).
  expect(within(table).getByText("$210.00")).toBeInTheDocument()
  expect(within(table).getByText("$310.00")).toBeInTheDocument()
})

it("does not show a truncation notice for a small ledger", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mTx.mockResolvedValue([
    { date: new Date("2025-07-01"), description: "Sunday collection", reference: "DEP1", type: "INCOME", amount: "100.00" },
  ])
  const ui = await GeneralLedgerPage({ searchParams: Promise.resolve({ account: "1", year: "2025" }) })
  render(ui)
  expect(screen.queryByText(/Showing the earliest/i)).not.toBeInTheDocument()
})

it("caps the listing at 5000 rows and shows a truncation notice when more exist", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  // 5001 rows: the page fetches take = 5000 + 1, detects overflow, and drops the
  // 5001st (a sentinel) from the rendered listing.
  const rows = Array.from({ length: 5001 }, (_, i) => ({
    date: new Date("2025-07-01"),
    description: i === 5000 ? "OVERFLOW SENTINEL ROW" : `row ${i}`,
    reference: null,
    type: "INCOME" as const,
    amount: "1.00",
  }))
  mTx.mockResolvedValue(rows)
  const ui = await GeneralLedgerPage({ searchParams: Promise.resolve({ account: "1", year: "2025" }) })
  render(ui)
  // The page asked for exactly one past the cap.
  expect(mTx).toHaveBeenCalledWith(expect.objectContaining({ take: 5001 }))
  expect(screen.getByText(/Showing the earliest 5,000 transactions/i)).toBeInTheDocument()
  // The row beyond the cap is not rendered.
  expect(screen.queryByText("OVERFLOW SENTINEL ROW")).not.toBeInTheDocument()
})
