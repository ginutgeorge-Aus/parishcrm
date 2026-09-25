/** @jest-environment node */
import { GET } from "../route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"
import { generateGeneralLedgerCsv, withRunningBalance } from "@/lib/generalLedgerExport"

// Locks in the general-ledger CSV export route gates (401/403), the
// EXPORT_FINANCIAL_REPORT audit trail, and the invalid `?account=` 400.

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findUnique: jest.fn() },
    transaction: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/generalLedgerExport", () => ({
  generateGeneralLedgerCsv: jest.fn(() => "csv"),
  withRunningBalance: jest.fn(() => []),
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
  ;(prisma.account.findUnique as jest.Mock).mockResolvedValue({ code: "1000", name: "Cash" })
  ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([])
})

it("401 when unauthenticated", async () => {
  mockAuth.mockResolvedValue(null)
  expect((await GET(req("?account=1"))).status).toBe(401)
})

it("403 for a VIEWER role, and no data query runs", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
  const res = await GET(req("?account=1"))
  expect(res.status).toBe(403)
  expect(prisma.account.findUnique).not.toHaveBeenCalled()
})

it("200 + EXPORT_FINANCIAL_REPORT audit for ADMIN", async () => {
  const res = await GET(req("?account=1&year=2026"))
  expect(res.status).toBe(200)
  expect(generateGeneralLedgerCsv).toHaveBeenCalled()
  expect(logAudit).toHaveBeenCalledWith(
    1,
    "EXPORT_FINANCIAL_REPORT",
    "GeneralLedger",
    undefined,
    expect.objectContaining({ report: "general-ledger", accountId: 1, year: 2026 }),
    "unknown",
  )
})

it("400 on a non-numeric ?account=, without querying the account", async () => {
  const res = await GET(req("?account=not-a-number"))
  expect(res.status).toBe(400)
  const body = await res.json()
  expect(body).toEqual({ error: "Invalid account" })
  expect(prisma.account.findUnique).not.toHaveBeenCalled()
})
