/** @jest-environment node */
import { GET } from "../route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"
import { generateBalanceSheetCsv } from "@/lib/reports/balanceSheetExport"

// Locks in the balance-sheet CSV export route gates (401/403), the
// EXPORT_FINANCIAL_REPORT audit trail, and the invalid-`?date=` fallback.

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    accountOpeningBalance: { findMany: jest.fn() },
    transaction: { aggregate: jest.fn() },
  },
}))
jest.mock("@/lib/reports/balanceSheetExport", () => ({
  generateBalanceSheetCsv: jest.fn(() => "csv"),
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
  // No opening balance rows → every account is inactive-at-date, so the route
  // never reaches the transaction.aggregate branch (kept as a stub anyway).
  ;(prisma.accountOpeningBalance.findMany as jest.Mock).mockResolvedValue([])
})

it("401 when unauthenticated", async () => {
  mockAuth.mockResolvedValue(null)
  expect((await GET(req())).status).toBe(401)
})

it("403 for a VIEWER role, and no data query runs", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
  const res = await GET(req())
  expect(res.status).toBe(403)
  expect(prisma.accountOpeningBalance.findMany).not.toHaveBeenCalled()
})

it("200 + EXPORT_FINANCIAL_REPORT audit for ADMIN", async () => {
  const res = await GET(req())
  expect(res.status).toBe(200)
  expect(generateBalanceSheetCsv).toHaveBeenCalled()
  expect(logAudit).toHaveBeenCalledWith(
    1,
    "EXPORT_FINANCIAL_REPORT",
    "BalanceSheet",
    undefined,
    expect.objectContaining({ report: "balance-sheet" }),
    "unknown",
  )
})

it("400s on an invalid ?date= instead of silently falling back to today", async () => {
  const res = await GET(req("?date=not-a-date"))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: "Invalid date" })
  expect(prisma.accountOpeningBalance.findMany).not.toHaveBeenCalled()
})

it("no ?date= still defaults to today", async () => {
  const res = await GET(req())
  expect(res.status).toBe(200)
})

it("footer total sums row balances in cents, not 100× larger", async () => {
  // One active account with a $100.00 opening balance and no movement →
  // balanceCents 10000. The footer total must equal that (10000), not the
  // sumCents-double-converted 1_000_000.
  ;(prisma.accountOpeningBalance.findMany as jest.Mock).mockResolvedValue([
    { paymentAccountId: 1, amount: { toString: () => "100.00" }, asOfDate: new Date("2020-01-01") },
  ])
  ;(prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null } })
  await GET(req("?date=2026-01-01"))
  const total = (generateBalanceSheetCsv as jest.Mock).mock.calls[0][1]
  expect(total).toBe(10000)
})
