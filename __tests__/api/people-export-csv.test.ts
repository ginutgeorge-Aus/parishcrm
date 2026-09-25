/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    person: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))

import { GET } from "@/app/api/people/export/route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { NextRequest } from "next/server"

const mockAuth = auth as jest.Mock
const mockFindMany = prisma.person.findMany as jest.Mock
const mockLogAudit = logAudit as jest.Mock

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/people/export${query}`)
}

const basePerson = {
  firstName: "Alice",
  lastName: "Jones",
  role: "MEMBER",
  classification: "ADULT",
  email: "enc:alice@example.com",
  mobile: "enc:0400123456",
  dateOfBirth: "enc:1990-01-15",
  membershipDate: null,
  baptismDate: null,
  family: { name: "Jones Family" },
}

describe("GET /api/people/export (bulk CSV)", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindMany.mockResolvedValue([basePerson])
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it("returns 403 for VIEWER", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "3" } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })

  it("returns 403 for PASTOR — bulk PII export is ADMIN only", async () => {
    mockAuth.mockResolvedValue({ user: { role: "PASTOR", id: "2" } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it("returns CSV with decrypted email, mobile and dateOfBirth", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/csv")
    const csv = await res.text()
    expect(csv).toContain("alice@example.com")
    expect(csv).toContain("0400123456")
    expect(csv).toContain("1990-01-15")
    expect(csv).not.toContain("enc:")
  })

  it("emits empty strings, not 'undefined', for missing optional fields", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue([{ ...basePerson, email: null, mobile: null, dateOfBirth: null }])
    const csv = await (await GET(makeRequest())).text()
    expect(csv).not.toContain("undefined")
    expect(csv).not.toContain("null")
    expect(csv.split("\n")[1]).toContain("Alice,Jones,Jones Family,MEMBER,ADULT,,,")
  })

  it("exports a person with no family without crashing", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue([{ ...basePerson, family: null }])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const csv = await res.text()
    // Empty Family cell, not a 500 — p.family is nullable.
    expect(csv.split("\n")[1]).toContain("Alice,Jones,,MEMBER,ADULT,")
  })

  it("escapes formula-injection prefixes in decrypted values", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue([{ ...basePerson, email: "enc:=cmd@example.com" }])
    const csv = await (await GET(makeRequest())).text()
    expect(csv).toContain("'=cmd@example.com")
  })

  it("caps the query with take to bound memory at scale", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await GET(makeRequest())
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10000 }))
  })

  it("flags a truncated export with X-Export-Truncated when the cap is hit", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue(Array.from({ length: 10000 }, () => basePerson))
    const res = await GET(makeRequest())
    expect(res.headers.get("X-Export-Truncated")).toBe("true")
  })

  it("does not shift membership/baptism dates back a day on a UTC-midnight anchor", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue([
      { ...basePerson, membershipDate: new Date("2020-01-01T00:00:00.000Z"), baptismDate: new Date("2020-12-31T00:00:00.000Z") },
    ])
    const csv = await (await GET(makeRequest())).text()
    expect(csv).toContain("01/JAN/2020")
    expect(csv).toContain("31/DEC/2020")
  })

  it("audit-logs EXPORT_CSV with row count and client IP", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    const req = new NextRequest("http://localhost/api/people/export", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(mockLogAudit).toHaveBeenCalledWith(7, "EXPORT_CSV", "Person", undefined, { rowCount: 1 }, "1.2.3.4")
  })
})
