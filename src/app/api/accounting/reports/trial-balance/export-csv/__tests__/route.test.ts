/** @jest-environment node */
import { GET } from "../route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"
import { generateTrialBalanceCsv } from "@/lib/reports/trialBalanceExport"

// Locks in the trial-balance CSV export route gates (401/403), the
// EXPORT_FINANCIAL_REPORT audit trail, and the invalid-`?year=` fallback.

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    transaction: { groupBy: jest.fn() },
  },
}))
jest.mock("@/lib/reports/trialBalanceExport", () => ({
  generateTrialBalanceCsv: jest.fn(() => "csv"),
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
  expect(generateTrialBalanceCsv).toHaveBeenCalled()
  expect(logAudit).toHaveBeenCalledWith(
    1,
    "EXPORT_FINANCIAL_REPORT",
    "TrialBalance",
    undefined,
    expect.objectContaining({ report: "trial-balance" }),
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
