/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    accountOpeningBalance: { findUnique: jest.fn() },
    reconciliationStatement: { findUnique: jest.fn() },
    transaction: { findMany: jest.fn(), aggregate: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
// Single BANK account so selectedAccount deterministically resolves to id 1
// with no ?paymentAccount= param — mirrors the "old" ANZ_CHURCH default.
jest.mock("@/lib/paymentAccounts", () => ({
  getPaymentAccounts: jest.fn().mockResolvedValue([
    { id: 1, name: "ANZ Church", kind: "BANK", isDefault: true, isActive: true },
  ]),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}))
jest.mock("@/components/accounting/ReconReportControls", () => ({
  ReconReportControls: () => null,
}))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { redirect } from "next/navigation"
import ReconciliationReportPage from "@/app/(dashboard)/accounting/reports/reconciliation/page"

const mockAuth = auth as jest.Mock
const mockObFindUnique = prisma.accountOpeningBalance.findUnique as jest.Mock
const mockStatementFindUnique = prisma.reconciliationStatement.findUnique as jest.Mock
const mockTxFindMany = prisma.transaction.findMany as jest.Mock
const mockTxAggregate = prisma.transaction.aggregate as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock
const mockLogAudit = logAudit as jest.Mock

const makeProps = (paymentAccount?: string, statementDate?: string) => ({
  searchParams: Promise.resolve({
    ...(paymentAccount && { paymentAccount }),
    ...(statementDate && { statementDate }),
  }),
})

const makeOb = (amount: string, asOfDate: string) => ({
  paymentAccountId: 1,
  amount: { toString: () => amount },
  asOfDate: new Date(asOfDate),
})

const makeStatement = (closingBalance: string) => ({
  paymentAccountId: 1,
  statementDate: new Date("2026-06-30"),
  closingBalance: { toString: () => closingBalance },
})

const makeAgg = (amount: string | null) => ({
  _sum: { amount: amount ? { toString: () => amount } : null },
  _count: amount ? 2 : 0,
})

beforeEach(() => jest.clearAllMocks())

describe("ReconciliationReportPage", () => {
  it("redirects VIEWER to /", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    await expect(ReconciliationReportPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })

  it("allows AUDITOR to view", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    mockObFindUnique.mockResolvedValue(null)
    mockStatementFindUnique.mockResolvedValue(null)
    mockTxAggregate.mockResolvedValue(makeAgg(null))
    const result = await ReconciliationReportPage(makeProps())
    expect(result).toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("defaults to the only account when paymentAccount param missing", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockResolvedValue(null)
    mockStatementFindUnique.mockResolvedValue(null)
    mockTxAggregate.mockResolvedValue(makeAgg(null))
    await ReconciliationReportPage(makeProps())
    expect(mockObFindUnique).toHaveBeenCalledWith({
      where: { paymentAccountId: 1 },
    })
  })

  it("normalizes default statementDate to UTC midnight so it matches saved statements", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockResolvedValue(null)
    mockStatementFindUnique.mockResolvedValue(null)
    mockTxAggregate.mockResolvedValue(makeAgg(null))
    await ReconciliationReportPage(makeProps()) // no statementDate param
    const arg = mockStatementFindUnique.mock.calls[0][0]
    const usedDate: Date = arg.where.paymentAccountId_statementDate.statementDate
    expect(usedDate.toISOString()).toMatch(/T00:00:00\.000Z$/)
  })

  it("defaults to the only account for an unknown paymentAccount id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockResolvedValue(null)
    mockStatementFindUnique.mockResolvedValue(null)
    mockTxAggregate.mockResolvedValue(makeAgg(null))
    await ReconciliationReportPage(makeProps("999", "2026-06-30"))
    expect(mockObFindUnique).toHaveBeenCalledWith({
      where: { paymentAccountId: 1 },
    })
  })

  it("skips findMany calls when no opening balance", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockResolvedValue(null)
    mockStatementFindUnique.mockResolvedValue(null)
    mockTxAggregate.mockResolvedValue(makeAgg(null))
    await ReconciliationReportPage(makeProps("1", "2026-06-30"))
    expect(mockTxFindMany).not.toHaveBeenCalled()
  })

  it("queries outstanding deposits as unreconciled INCOME anchored to asOfDate", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockResolvedValue(makeOb("10000", "2025-09-15")) // mid-FY anchor ≠ fyStart
    mockStatementFindUnique.mockResolvedValue(makeStatement("12820"))
    mockTxFindMany.mockResolvedValue([])
    mockTxAggregate.mockResolvedValue(makeAgg("0"))
    await ReconciliationReportPage(makeProps("1", "2026-06-30"))
    expect(mockTxFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentAccountId: 1,
          type: "INCOME",
          reconciled: false,
          date: expect.objectContaining({ gte: new Date("2025-09-15") }),
        }),
      })
    )
  })

  it("queries outstanding payments as unreconciled EXPENSE anchored to asOfDate", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockResolvedValue(makeOb("10000", "2025-09-15"))
    mockStatementFindUnique.mockResolvedValue(makeStatement("12820"))
    mockTxFindMany.mockResolvedValue([])
    mockTxAggregate.mockResolvedValue(makeAgg("0"))
    await ReconciliationReportPage(makeProps("1", "2026-06-30"))
    expect(mockTxFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentAccountId: 1,
          type: "EXPENSE",
          reconciled: false,
          date: expect.objectContaining({ gte: new Date("2025-09-15") }),
        }),
      })
    )
  })

  it("queries cleared income as reconciled INCOME from asOfDate", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockResolvedValue(makeOb("10000", "2025-07-01"))
    mockStatementFindUnique.mockResolvedValue(makeStatement("12820"))
    mockTxFindMany.mockResolvedValue([])
    mockTxAggregate.mockResolvedValue(makeAgg("0"))
    await ReconciliationReportPage(makeProps("1", "2026-06-30"))
    expect(mockTxAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentAccountId: 1,
          type: "INCOME",
          reconciled: true,
        }),
      })
    )
  })

  it("queries cleared expenses as reconciled EXPENSE from asOfDate", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockResolvedValue(makeOb("10000", "2025-07-01"))
    mockStatementFindUnique.mockResolvedValue(makeStatement("12820"))
    mockTxFindMany.mockResolvedValue([])
    mockTxAggregate.mockResolvedValue(makeAgg("0"))
    await ReconciliationReportPage(makeProps("1", "2026-06-30"))
    expect(mockTxAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentAccountId: 1,
          type: "EXPENSE",
          reconciled: true,
        }),
      })
    )
  })

  it("renders without error with full data", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockResolvedValue(makeOb("10000", "2025-07-01"))
    mockStatementFindUnique.mockResolvedValue(makeStatement("12820"))
    mockTxFindMany.mockResolvedValue([])
    mockTxAggregate
      .mockResolvedValueOnce(makeAgg("5230")) // cleared income
      .mockResolvedValueOnce(makeAgg("1860")) // cleared expense
      .mockResolvedValueOnce({ _sum: { amount: null }, _count: 5 }) // total count
    const result = await ReconciliationReportPage(makeProps("1", "2026-06-30"))
    expect(result).toBeDefined()
  })

  it("uses the house .tabular utility for balance figures, not font-mono", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockResolvedValue(makeOb("10000", "2025-07-01"))
    mockStatementFindUnique.mockResolvedValue(makeStatement("12820"))
    mockTxFindMany.mockResolvedValue([])
    mockTxAggregate
      .mockResolvedValueOnce(makeAgg("5230"))
      .mockResolvedValueOnce(makeAgg("1860"))
      .mockResolvedValueOnce({ _sum: { amount: null }, _count: 5 })
    const element = await ReconciliationReportPage(makeProps("1", "2026-06-30"))
    const html = renderToStaticMarkup(element as React.ReactElement)
    expect(html).toMatch(/class="[^"]*\btabular\b[^"]*"/)
    expect(html).not.toContain("font-mono")
  })

  it("logs a VIEW (not EXPORT) audit on every load for accounting roles", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindUnique.mockResolvedValue(null)
    mockStatementFindUnique.mockResolvedValue(null)
    mockTxAggregate.mockResolvedValue(makeAgg(null))
    await ReconciliationReportPage(makeProps())
    expect(mockLogAudit).toHaveBeenCalledWith(
      1,
      "VIEW_FINANCIAL_REPORT",
      "ReconciliationReport",
      undefined,
      expect.objectContaining({ report: "reconciliation" })
    )
  })
})
