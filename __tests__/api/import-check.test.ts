/**
 * @jest-environment node
 */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  },
}))
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => true),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rateLimit"
import { POST } from "@/app/api/import/families/check/route"
import { NextRequest } from "next/server"

const mockSession = auth as jest.Mock
const mockFamilyFindMany = prisma.family.findMany as jest.Mock
const mockRateLimit = rateLimit as jest.Mock

function makeCsvRequest(csvContent: string) {
  const formData = new FormData()
  formData.set("file", new Blob([csvContent], { type: "text/csv" }), "import.csv")
  return new NextRequest("http://localhost/api/import/families/check", {
    method: "POST",
    body: formData,
    headers: { "content-length": "1024" },
  })
}

beforeEach(() => {
  jest.resetAllMocks()
  mockRateLimit.mockReturnValue(true)
})

describe("POST /api/import/families/check", () => {
  it("returns 401 when unauthenticated", async () => {
    mockSession.mockResolvedValue(null)
    const res = await POST(makeCsvRequest("family_name,first_name,last_name\n"))
    expect(res.status).toBe(401)
  })

  it("returns 403 for non-ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const res = await POST(makeCsvRequest("family_name,first_name,last_name\n"))
    expect(res.status).toBe(403)
  })

  it("returns 400 when no file provided", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const req = new NextRequest("http://localhost/api/import/families/check", {
      method: "POST",
      body: new FormData(),
      headers: { "content-length": "1024" },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns rows and empty duplicates when no existing families match", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFamilyFindMany.mockResolvedValue([])

    const csv = [
      "family_name,first_name,last_name,role,classification",
      "Smith,John,Smith,HEAD,MEMBER",
    ].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.rows).toHaveLength(1)
    expect(body.duplicates).toEqual([])
    expect(body.errors).toEqual([])
  })

  it("marks existing family name as duplicate", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFamilyFindMany
      .mockResolvedValueOnce([{ name: "Smith" }]) // by name
      .mockResolvedValueOnce([]) // by memberNo

    const csv = [
      "family_name,first_name,last_name,role,classification",
      "Smith,John,Smith,HEAD,MEMBER",
      "Jones,Alice,Jones,HEAD,MEMBER",
    ].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.duplicates).toContain("Smith")
    expect(body.duplicates).not.toContain("Jones")
  })

  it("marks family as duplicate when memberNo already exists", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFamilyFindMany
      .mockResolvedValueOnce([]) // by name
      .mockResolvedValueOnce([{ name: "OldSmith", memberNo: "C90/91" }]) // by memberNo

    const csv = [
      "family_name,member_no,first_name,last_name,role,classification",
      "Smith,C90/91,John,Smith,HEAD,MEMBER",
    ].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.duplicates).toContain("Smith")
  })

  it("flags BOTH families when the CSV reuses one memberNo across different families", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFamilyFindMany.mockResolvedValue([]) // nothing in DB — conflict is intra-file

    const csv = [
      "family_name,member_no,first_name,last_name,role,classification",
      "Smith,C90/91,John,Smith,HEAD,MEMBER",
      "Jones,C90/91,Alice,Jones,HEAD,MEMBER",
    ].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.duplicates).toContain("Smith")
    expect(body.duplicates).toContain("Jones")
  })

  it("flags every CSV family sharing a memberNo that already exists in the DB", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFamilyFindMany
      .mockResolvedValueOnce([]) // by name
      .mockResolvedValueOnce([{ name: "OldSmith", memberNo: "C90/91" }]) // by memberNo

    const csv = [
      "family_name,member_no,first_name,last_name,role,classification",
      "Smith,C90/91,John,Smith,HEAD,MEMBER",
      "Jones,C90/91,Alice,Jones,HEAD,MEMBER",
    ].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.duplicates).toContain("Smith")
    expect(body.duplicates).toContain("Jones")
  })

  it("handles a memberNo that collides with an Object.prototype key without crashing", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFamilyFindMany.mockResolvedValue([]) // conflict is intra-file

    // "constructor"/"__proto__" as memberNo would break a plain-object dict.
    const csv = [
      "family_name,member_no,first_name,last_name,role,classification",
      "Smith,constructor,John,Smith,HEAD,MEMBER",
      "Jones,constructor,Alice,Jones,HEAD,MEMBER",
      "Brown,__proto__,Bob,Brown,HEAD,MEMBER",
    ].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(res.status).toBe(200)
    // Both families sharing the "constructor" memberNo are still flagged.
    expect(body.duplicates).toContain("Smith")
    expect(body.duplicates).toContain("Jones")
  })

  it("rate-limits on its own bucket, distinct from the commit route", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFamilyFindMany.mockResolvedValue([])

    await POST(makeCsvRequest("family_name,first_name,last_name\n"))

    expect(mockRateLimit).toHaveBeenCalledWith("import:families:check:999", 10, 60_000)
  })

  it("returns parse errors for invalid rows", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFamilyFindMany.mockResolvedValue([])

    const csv = [
      "family_name,first_name,last_name,role,classification",
      ",John,Smith,HEAD,MEMBER",
    ].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.rows).toHaveLength(0)
    expect(body.errors).toHaveLength(1)
  })
})
