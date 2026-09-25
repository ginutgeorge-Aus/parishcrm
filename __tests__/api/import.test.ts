/**
 * @jest-environment node
 */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { upsert: jest.fn() },
    person: { findMany: jest.fn(), createMany: jest.fn() },
    auditLog: { create: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  hmacEmail: jest.fn((v: string) => `hash:${v.trim().toLowerCase()}`),
  hmacMobile: jest.fn((v: string) => `mhash:${v.trim()}`),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { POST } from "@/app/api/import/families/route"
import { NextRequest } from "next/server"

const mockSession = auth as jest.Mock
const mockFamilyUpsert = prisma.family.upsert as jest.Mock
const mockPersonFindMany = prisma.person.findMany as jest.Mock
const mockPersonCreateMany = prisma.person.createMany as jest.Mock

function makeCsvRequest(csvContent: string) {
  const formData = new FormData()
  formData.set("file", new Blob([csvContent], { type: "text/csv" }), "import.csv")
  return new NextRequest("http://localhost/api/import/families", {
    method: "POST",
    body: formData,
    headers: { "content-length": "1024" },
  })
}

const HEADER = "family_name,address,suburb,state,postcode,first_name,last_name,dob,gender,role,classification,email,mobile"

beforeEach(() => {
  jest.clearAllMocks()
  mockFamilyUpsert.mockResolvedValue({ id: 1 })
  mockPersonFindMany.mockResolvedValue([]) // default: no existing persons
  mockPersonCreateMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }))
})

describe("POST /api/import/families", () => {
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
    const req = new NextRequest("http://localhost/api/import/families", {
      method: "POST",
      body: new FormData(),
      headers: { "content-length": "1024" },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("imports valid CSV and returns result summary", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })

    const csv = [HEADER, "Smith,12 High St,Sampletown,NSW,2150,John,Smith,,,HEAD,MEMBER,,"].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ imported: 1, skipped: 0, errors: [] })
    expect(mockFamilyUpsert).toHaveBeenCalledTimes(1)
    expect(mockPersonCreateMany).toHaveBeenCalledTimes(1)
  })

  it("upserts each distinct family exactly once, not once per member", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })

    const csv = [
      HEADER,
      "Smith,12 High St,Sampletown,NSW,2150,John,Smith,,,HEAD,MEMBER,,",
      "Smith,,,,,Jane,Smith,,,SPOUSE,MEMBER,,",
      "Smith,,,,,Jack,Smith,,,CHILD,MEMBER,,",
    ].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(mockFamilyUpsert).toHaveBeenCalledTimes(1)
    expect(mockPersonCreateMany).toHaveBeenCalledTimes(1)
    expect(mockPersonCreateMany.mock.calls[0][0].data).toHaveLength(3)
    expect(body).toMatchObject({ imported: 3, skipped: 0, errors: [] })
  })

  it("encrypts email and mobile on import", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })

    const csv = [
      HEADER,
      "Smith,12 High St,Sampletown,NSW,2150,Alice,Smith,,,HEAD,MEMBER,alice@example.com,0400123456",
    ].join("\n")

    await POST(makeCsvRequest(csv))
    expect(mockPersonCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            email: "enc:alice@example.com",
            emailHash: "hash:alice@example.com",
            mobile: "enc:0400123456",
            mobileHash: "mhash:0400123456", // blind index set on CSV import
          }),
        ],
      })
    )
  })

  it("sets consentUpdatedAt on imported persons", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })

    const csv = [HEADER, "Smith,12 High St,Sampletown,NSW,2150,John,Smith,,,HEAD,MEMBER,,"].join("\n")

    await POST(makeCsvRequest(csv))
    const arg = mockPersonCreateMany.mock.calls[0][0]
    expect(arg.data[0].consentUpdatedAt).toBeInstanceOf(Date)
  })

  it("counts existing persons as skipped, not imported", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockPersonFindMany.mockResolvedValue([{ familyId: 1, firstName: "John", lastName: "Smith" }])

    const csv = [HEADER, "Smith,12 High St,Sampletown,NSW,2150,John,Smith,,,HEAD,MEMBER,,"].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(body).toMatchObject({ imported: 0, skipped: 1, errors: [] })
    expect(mockPersonCreateMany).not.toHaveBeenCalled()
  })

  it("counts a duplicate person within the same CSV as skipped", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })

    const csv = [
      HEADER,
      "Smith,12 High St,Sampletown,NSW,2150,John,Smith,,,HEAD,MEMBER,,",
      "Smith,12 High St,Sampletown,NSW,2150,John,Smith,,,HEAD,MEMBER,,",
    ].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(body).toMatchObject({ imported: 1, skipped: 1 })
    expect(mockPersonCreateMany).toHaveBeenCalledTimes(1)
    expect(mockPersonCreateMany.mock.calls[0][0].data).toHaveLength(1)
  })

  it("reports a friendly per-row error with detail when a family memberNo collides", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFamilyUpsert.mockRejectedValue(
      new Error("Unique constraint failed on the fields: (`memberNo`)")
    )

    const csv = [HEADER, "Smith,12 High St,Sampletown,NSW,2150,John,Smith,,,HEAD,MEMBER,,"].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(body.imported).toBe(0)
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0].row).toBe(2)
    expect(body.errors[0].message).toMatch(/member number/i)
    expect(mockPersonFindMany).not.toHaveBeenCalled()
    expect(mockPersonCreateMany).not.toHaveBeenCalled()
  })

  it("returns errors for invalid rows in result", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })

    const csv = [HEADER, ",,,,,John,Smith,,,HEAD,MEMBER,,"].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.imported).toBe(0)
    expect(body.errors).toHaveLength(1)
  })

  it("rejects a CSV exceeding the row cap before touching the DB", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })

    const rows = Array.from({ length: 5001 }, (_, i) => `Family${i},,,,,John,Smith,,,HEAD,MEMBER,,`)
    const csv = [HEADER, ...rows].join("\n")

    const res = await POST(makeCsvRequest(csv))
    const body = await res.json()

    expect(res.status).toBe(413)
    expect(body.error).toMatch(/too many rows/i)
    expect(mockFamilyUpsert).not.toHaveBeenCalled()
    expect(mockPersonFindMany).not.toHaveBeenCalled()
    expect(mockPersonCreateMany).not.toHaveBeenCalled()
  })
})
