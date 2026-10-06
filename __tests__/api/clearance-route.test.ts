/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({ prisma: { personClearance: { findUnique: jest.fn() } } }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))

import { NextRequest } from "next/server"
import { GET } from "@/app/api/people/[id]/clearances/[clearanceId]/route"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"

const find = prisma.personClearance.findUnique as jest.Mock
const mockAuth = auth as jest.Mock
const mockRate = rateLimit as jest.Mock
const CID = "ckclearance000000000000001"
const call = (id: string, clearanceId: string, headers: Record<string, string> = {}) =>
  GET(new NextRequest("http://test.local/", { headers }), { params: Promise.resolve({ id, clearanceId }) })

const blob = (raw: string) => Buffer.from(`enc:${Buffer.from(raw).toString("base64")}`, "utf8")
const row = (over: Record<string, unknown> = {}) => ({
  personId: 3,
  type: "WWCC",
  document: blob("PDFBYTES"),
  documentType: "application/pdf",
  documentName: "enc:wwcc.pdf",
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockRate.mockReturnValue(true)
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
})

it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER"])("404s %s without touching the DB", async (role) => {
  mockAuth.mockResolvedValue({ user: { role, id: "2" } })
  expect((await call("3", CID)).status).toBe(404)
  expect(find).not.toHaveBeenCalled()
})

it("404s an unauthenticated request", async () => {
  mockAuth.mockResolvedValue(null)
  expect((await call("3", CID)).status).toBe(404)
})

it("404s a non-numeric person id or a malformed clearance id without a DB read", async () => {
  expect((await call("abc", CID)).status).toBe(404)
  expect((await call("3", "../etc")).status).toBe(404)
  expect(find).not.toHaveBeenCalled()
})

it("404s when the clearance belongs to a different person (ownership mismatch)", async () => {
  find.mockResolvedValue(row({ personId: 99 }))
  expect((await call("3", CID)).status).toBe(404)
  expect(logAudit).not.toHaveBeenCalled()
})

it("404s a missing row and a row with no document", async () => {
  find.mockResolvedValue(null)
  expect((await call("3", CID)).status).toBe(404)
  find.mockResolvedValue(row({ document: null }))
  expect((await call("3", CID)).status).toBe(404)
})

it("429s when rate limited (30/min per user)", async () => {
  mockRate.mockReturnValue(false)
  expect((await call("3", CID)).status).toBe(429)
  expect(mockRate).toHaveBeenCalledWith("clearance:1", 30, 60_000)
})

it("decrypts and serves inline with no-store/nosniff, and audits with the client IP", async () => {
  find.mockResolvedValue(row())
  const res = await call("3", CID, { "x-forwarded-for": "203.0.113.9" })
  expect(res.status).toBe(200)
  expect(res.headers.get("Content-Type")).toBe("application/pdf")
  expect(res.headers.get("Content-Disposition")).toContain("inline")
  expect(res.headers.get("Content-Disposition")).toContain("wwcc.pdf")
  expect(res.headers.get("Cache-Control")).toBe("private, no-store")
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
  expect(await res.text()).toBe("PDFBYTES")
  expect(logAudit).toHaveBeenCalledWith(1, "CLEARANCE_VIEWED", "Person", 3,
    { type: "WWCC", clearanceId: CID }, "203.0.113.9")
})

it("forces download as octet-stream for a non-allowlisted stored type", async () => {
  find.mockResolvedValue(row({ documentType: "text/html" }))
  const res = await call("3", CID)
  expect(res.headers.get("Content-Type")).toBe("application/octet-stream")
  expect(res.headers.get("Content-Disposition")).toContain("attachment")
})
