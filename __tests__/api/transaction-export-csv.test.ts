/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))

import { GET } from "@/app/api/accounting/transactions/export-csv/route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { NextRequest } from "next/server"

const mockAuth = auth as jest.Mock
const mockFindMany = prisma.transaction.findMany as jest.Mock
const mockLogAudit = logAudit as jest.Mock

const adminSession = { user: { role: "ADMIN", id: "1" } }
const pastorSession = { user: { role: "PASTOR", id: "2" } }

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/accounting/transactions/export-csv")
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    date: new Date("2026-03-15"),
    description: "enc:Tithe offering",
    amount: { toString: () => "500.00" },
    type: "INCOME",
    paymentAccountRel: null,
    reference: null,
    notes: null,
    reconciled: false,
    account: { code: "4001", name: "Tithes" },
    family: null,
    person: null,
    ...overrides,
  }
}

beforeEach(() => jest.clearAllMocks())

describe("GET /api/accounting/transactions/export-csv", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it("returns 403 for VIEWER role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "3" } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })

  it("returns 400 for invalid type param", async () => {
    mockAuth.mockResolvedValue(adminSession)
    const res = await GET(makeRequest({ type: "BOGUS" }))
    expect(res.status).toBe(400)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid paymentAccount param", async () => {
    mockAuth.mockResolvedValue(adminSession)
    const res = await GET(makeRequest({ paymentAccount: "EVIL'); DROP" }))
    expect(res.status).toBe(400)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it("accepts valid type and paymentAccount params", async () => {
    mockAuth.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([makeTx()])
    const res = await GET(makeRequest({ type: "INCOME", paymentAccount: "1" }))
    expect(res.status).toBe(200)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "INCOME", paymentAccountId: 1 }),
      })
    )
  })

  it("returns 200 with text/csv for AUDITOR", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "4" } })
    mockFindMany.mockResolvedValue([makeTx()])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/csv")
  })

  it("returns 200 with text/csv for ADMIN", async () => {
    mockAuth.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([makeTx()])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/csv")
  })

  it("returns 200 with text/csv for PASTOR", async () => {
    mockAuth.mockResolvedValue(pastorSession)
    mockFindMany.mockResolvedValue([makeTx()])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
  })

  it("decrypts description before writing to CSV", async () => {
    mockAuth.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([makeTx({ description: "enc:Tithe offering" })])
    const res = await GET(makeRequest())
    const text = await res.text()
    expect(text).toContain("Tithe offering")
    expect(text).not.toContain("enc:")
  })

  it("applies q filter — includes matching rows only", async () => {
    mockAuth.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([
      makeTx({ id: 1, description: "enc:Tithe offering" }),
      makeTx({ id: 2, description: "enc:Hall rental" }),
    ])
    const res = await GET(makeRequest({ q: "tithe" }))
    const text = await res.text()
    expect(text).toContain("Tithe offering")
    expect(text).not.toContain("Hall rental")
  })

  it("calls logAudit with EXPORT_TRANSACTION_CSV and rowCount", async () => {
    mockAuth.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([makeTx(), makeTx({ id: 2 })])
    await GET(makeRequest())
    expect(mockLogAudit).toHaveBeenCalledWith(
      1,
      "EXPORT_TRANSACTION_CSV",
      "Transaction",
      undefined,
      { rowCount: 2 },
      "unknown"
    )
  })

  it("sets content-disposition with dated filename", async () => {
    mockAuth.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([])
    const res = await GET(makeRequest())
    expect(res.headers.get("content-disposition")).toMatch(
      /attachment; filename="transactions-\d{4}-\d{2}-\d{2}\.csv"/
    )
  })

  it("returns header-only CSV when no rows match", async () => {
    mockAuth.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([])
    const res = await GET(makeRequest())
    const text = await res.text()
    expect(text.split("\n").length).toBe(1)
    expect(text).toContain("Date,Description")
  })
})
