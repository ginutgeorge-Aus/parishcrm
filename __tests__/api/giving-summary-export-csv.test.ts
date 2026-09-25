/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/givingSummary", () => ({
  getGivingSummary: jest.fn().mockResolvedValue([]),
  generateGivingSummaryCsv: jest.fn(() => "Family,Total\n"),
}))

import { GET } from "@/app/api/accounting/reports/giving-summary/export-csv/route"
import { auth } from "@/auth"
import { NextRequest } from "next/server"

const mockAuth = auth as jest.Mock

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/accounting/reports/giving-summary/export-csv")
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

beforeEach(() => jest.clearAllMocks())

describe("GET /api/accounting/reports/giving-summary/export-csv", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it("returns 403 for VIEWER (no accounting access)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })

  // the report page itself uses canViewAccounting (ADMIN|PASTOR|AUDITOR|
  // OFFICE_ADMIN, read-only) — the CSV export must match, since exporting a
  // read-only report shouldn't require mutation permission.
  it("returns 200 with text/csv for AUDITOR", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "2" } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/csv")
  })

  it("returns 200 with text/csv for OFFICE_ADMIN", async () => {
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_ADMIN", id: "3" } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
  })

  it("returns 200 with text/csv for ADMIN", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "4" } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
  })

  it("returns 200 with text/csv for PASTOR", async () => {
    mockAuth.mockResolvedValue({ user: { role: "PASTOR", id: "5" } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
  })

  // AUDITOR is accounting-only — the CSV export must gate the
  // decrypted primary email the same way the report page does.
  it("gates getGivingSummary/generateGivingSummaryCsv on canViewPeople for AUDITOR (false) vs ADMIN (true)", async () => {
    const { getGivingSummary, generateGivingSummaryCsv } = jest.requireMock("@/lib/givingSummary")

    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "2" } })
    await GET(makeRequest())
    expect(getGivingSummary).toHaveBeenLastCalledWith(expect.any(Number), false)
    expect(generateGivingSummaryCsv).toHaveBeenLastCalledWith(expect.anything(), false)

    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "4" } })
    await GET(makeRequest())
    expect(getGivingSummary).toHaveBeenLastCalledWith(expect.any(Number), true)
    expect(generateGivingSummaryCsv).toHaveBeenLastCalledWith(expect.anything(), true)
  })
})
