/** @jest-environment node */
import { GET } from "../route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"
import { generateCashFlowCsv } from "@/lib/reports/cashFlowExport"

// Locks in the cash-flow CSV export route gates (401/403), the
// EXPORT_FINANCIAL_REPORT audit trail, and the invalid-`?year=` fallback.

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    transaction: { groupBy: jest.fn(), aggregate: jest.fn() },
    accountOpeningBalance: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/reports/cashFlowExport", () => ({
  generateCashFlowCsv: jest.fn(() => "csv"),
}))
// Single BANK account — mirrors the "old" ANZ_CHURCH-only fixture below.
jest.mock("@/lib/paymentAccounts", () => ({
  getPaymentAccounts: jest.fn().mockResolvedValue([
    { id: 1, name: "ANZ Church", kind: "BANK", isDefault: true, isActive: true },
  ]),
}))

const mockAuth = auth as jest.Mock

function req(qs = "") {
  return {
    nextUrl: new URL(`https://x.test/api${qs}`),
    headers: { get: () => null },
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(rateLimit as jest.Mock).mockReturnValue(true)
  ;(prisma.account.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.transaction.groupBy as jest.Mock).mockResolvedValue([])
  // No opening balance for any payment account → positions branch never calls
  // movement()/transaction.aggregate (kept as a stub anyway).
  ;(prisma.accountOpeningBalance.findUnique as jest.Mock).mockResolvedValue(null)
})

it("401 when unauthenticated", async () => {
  mockAuth.mockResolvedValue(null)
  expect((await GET(req())).status).toBe(401)
})

it("403 for a VIEWER role, and no data query runs", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
  const res = await GET(req())
  expect(res.status).toBe(403)
  expect(prisma.account.findMany).not.toHaveBeenCalled()
})

it("200 + EXPORT_FINANCIAL_REPORT audit for ADMIN", async () => {
  const res = await GET(req())
  expect(res.status).toBe(200)
  expect(generateCashFlowCsv).toHaveBeenCalled()
  expect(logAudit).toHaveBeenCalledWith(
    1,
    "EXPORT_FINANCIAL_REPORT",
    "CashFlow",
    undefined,
    expect.objectContaining({ report: "cash-flow" }),
    "unknown",
  )
})

it("400s on an invalid ?year= instead of silently falling back to the current FY", async () => {
  const res = await GET(req("?year=not-a-year"))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: "Invalid year" })
  expect(prisma.account.findMany).not.toHaveBeenCalled()
})

it("400s on an out-of-range ?year=", async () => {
  const res = await GET(req("?year=999999"))
  expect(res.status).toBe(400)
})

it("no ?year= still defaults to the current FY", async () => {
  const res = await GET(req())
  expect(res.status).toBe(200)
})

it("closing footer total sums position closings in cents, not 100× larger", async () => {
  // One PaymentAccount with a $100.00 opening balance (asOfDate inside the FY,
  // after fyStart) and no movement → closingCents 10000. The closing footer
  // total must equal that (10000), not the sumCents-double-converted 1_000_000.
  ;(prisma.accountOpeningBalance.findUnique as jest.Mock).mockImplementation(
    ({ where }: { where: { paymentAccountId: number } }) =>
      where.paymentAccountId === 1
        ? Promise.resolve({ amount: { toString: () => "100.00" }, asOfDate: new Date("2025-12-01") })
        : Promise.resolve(null),
  )
  ;(prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null } })
  await GET(req("?year=2025"))
  const totalClosing = (generateCashFlowCsv as jest.Mock).mock.calls[0][3]
  expect(totalClosing).toBe(10000)
})
