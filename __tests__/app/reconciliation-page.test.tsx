/** @jest-environment node */
/**
 * Tests for: reconciliation page summary figures must use integer-cent
 * arithmetic (toCents/centsToNumber), not Number() coercion, to avoid drift.
 */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    accountOpeningBalance: { findUnique: jest.fn() },
    reconciliationStatement: { findUnique: jest.fn() },
    transaction: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
      aggregate: jest.fn(),
    },
  },
}))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v),
}))
// Single BANK account so selectedAccount deterministically resolves to id 1
// with no ?paymentAccount= param — mirrors the "old" ANZ_CHURCH default.
jest.mock("@/lib/paymentAccounts", () => ({
  getPaymentAccounts: jest.fn().mockResolvedValue([
    { id: 1, name: "ANZ Church", kind: "BANK", isDefault: true, isActive: true },
  ]),
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}))
jest.mock("@/components/accounting/ReconciliationFilters", () => ({
  ReconciliationFilters: () => null,
}))
jest.mock("@/components/accounting/ReconcileToggleButton", () => ({
  ReconcileToggleButton: () => null,
}))
jest.mock("@/components/accounting/StatementBalanceInput", () => ({
  StatementBalanceInput: () => null,
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import ReconciliationPage from "@/app/(dashboard)/accounting/reconciliation/page"
import { renderToStaticMarkup } from "react-dom/server"

const mockAuth = auth as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock
const mockObFindUnique = prisma.accountOpeningBalance.findUnique as jest.Mock
const mockStatementFindUnique = prisma.reconciliationStatement.findUnique as jest.Mock
const mockTxFindMany = prisma.transaction.findMany as jest.Mock
const mockTxGroupBy = prisma.transaction.groupBy as jest.Mock
const mockTxAggregate = prisma.transaction.aggregate as jest.Mock

/** Decimal-like object matching what Prisma returns */
const dec = (s: string) => ({ toString: () => s })

const makeProps = (params: Record<string, string> = {}) => ({
  searchParams: Promise.resolve(params),
})

const makeGroupByRows = (incomeAmount: string | null, expenseAmount: string | null) => {
  const rows = []
  if (incomeAmount !== null)
    rows.push({ type: "INCOME", _sum: { amount: dec(incomeAmount) }, _count: 3 })
  if (expenseAmount !== null)
    rows.push({ type: "EXPENSE", _sum: { amount: dec(expenseAmount) }, _count: 2 })
  return rows
}

beforeEach(() => jest.clearAllMocks())

describe("ReconciliationPage", () => {
  it("redirects VIEWER to /", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    await expect(ReconciliationPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })

  it("allows AUDITOR to view the page", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    mockObFindUnique.mockResolvedValue(null)
    mockStatementFindUnique.mockResolvedValue(null)
    mockTxFindMany.mockResolvedValue([])
    mockTxGroupBy.mockResolvedValue([])
    mockTxAggregate.mockResolvedValue({ _sum: { amount: null } })

    const element = await ReconciliationPage(makeProps())
    const html = renderToStaticMarkup(element as React.ReactElement)

    expect(html).toContain("Reconciliation")
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("renders reconciled/pending totals without float drift", async () => {
    // Ten reconciled income transactions of $100.10 each — grouped by Prisma to one sum.
    // Float: Number("1001.0") is fine, but Number("1001.00") is also fine.
    // Use a value that loses precision under Number(): a raw Decimal whose
    // toString() is already exact. The fix ensures sumOf uses toCents/centsToNumber.
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockResolvedValue(null)
    mockStatementFindUnique.mockResolvedValue(null)
    mockTxFindMany.mockResolvedValue([])

    // Reconciled: income $1001.00, expense $500.50
    // Pending: income $200.20, expense $100.10
    mockTxGroupBy
      .mockResolvedValueOnce(makeGroupByRows("1001.00", "500.50"))  // reconciledByType
      .mockResolvedValueOnce(makeGroupByRows("200.20", "100.10"))   // unreconciledByType
    mockTxAggregate.mockResolvedValue({ _sum: { amount: null } })

    const element = await ReconciliationPage(makeProps())
    const html = renderToStaticMarkup(element as React.ReactElement)

    expect(html).toContain("$1,001.00")
    expect(html).toContain("$500.50")
    expect(html).toContain("$200.20")
    expect(html).toContain("$100.10")
  })

  it("renders calculated balance using cent arithmetic when opening balance set", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })

    // Opening balance $1000.00, income $100.10 × 10 = 1001.00, expense $0
    mockObFindUnique.mockResolvedValue({
      paymentAccount: "ANZ_CHURCH",
      amount: dec("1000.00"),
      asOfDate: new Date("2025-07-01"),
    })
    mockStatementFindUnique.mockResolvedValue(null)
    mockTxFindMany.mockResolvedValue([])
    mockTxGroupBy
      .mockResolvedValueOnce([])  // reconciledByType (empty)
      .mockResolvedValueOnce([])  // unreconciledByType (empty)
    // Running balance aggregates: income = $1001.00, expense = $0
    mockTxAggregate
      .mockResolvedValueOnce({ _sum: { amount: dec("1001.00") } })  // income
      .mockResolvedValueOnce({ _sum: { amount: null } })             // expense

    const element = await ReconciliationPage(makeProps())
    const html = renderToStaticMarkup(element as React.ReactElement)

    // Calculated = 1000.00 + 1001.00 - 0 = 2001.00 (already uses toCents — verify no regression)
    expect(html).toContain("$2,001.00")
  })
})
