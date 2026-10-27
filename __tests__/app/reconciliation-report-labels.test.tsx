/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    accountOpeningBalance: { findUnique: jest.fn() },
    reconciliationStatement: { findUnique: jest.fn() },
    transaction: { findMany: jest.fn(), aggregate: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({ decrypt: jest.fn((v: string) => v) }))
jest.mock("@/lib/paymentAccounts", () => ({
  getPaymentAccounts: jest.fn().mockResolvedValue([
    { id: 1, name: "ANZ Church", kind: "BANK", isDefault: true, isActive: true },
  ]),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}))
jest.mock("@/components/accounting/ReconReportControls", () => ({ ReconReportControls: () => null }))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import ReconciliationReportPage from "@/app/(dashboard)/accounting/reports/reconciliation/page"

const props = { searchParams: Promise.resolve({ paymentAccount: "1", statementDate: "2026-06-30" }) }

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null }, _count: 0 })
})

it("uses sentence case for report labels", async () => {
  ;(prisma.accountOpeningBalance.findUnique as jest.Mock).mockResolvedValue({
    paymentAccountId: 1, amount: { toString: () => "1000" }, asOfDate: new Date("2025-09-15"),
  })
  ;(prisma.reconciliationStatement.findUnique as jest.Mock).mockResolvedValue({
    paymentAccountId: 1, statementDate: new Date("2026-06-30"), closingBalance: { toString: () => "1000" },
  })
  const html = renderToStaticMarkup(await ReconciliationReportPage(props))
  for (const label of ["Calculated balance", "Bank reconciliation report"]) expect(html).toContain(label)
  for (const old of ["Calculated Balance", "Bank Reconciliation Report"]) expect(html).not.toContain(old)
})

it("links to Accounting settings (sentence case) when no opening balance is set", async () => {
  ;(prisma.accountOpeningBalance.findUnique as jest.Mock).mockResolvedValue(null)
  ;(prisma.reconciliationStatement.findUnique as jest.Mock).mockResolvedValue(null)
  const html = renderToStaticMarkup(await ReconciliationReportPage(props))
  expect(html).toContain("Accounting settings")
  expect(html).not.toContain("Accounting Settings")
})
