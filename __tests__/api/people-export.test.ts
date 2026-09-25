/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    person: { findFirst: jest.fn() },
    registration: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))

import { GET } from "@/app/api/people/[id]/export/route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { __resetRateLimit } from "@/lib/rateLimit"
import { NextRequest } from "next/server"

const mockAuth = auth as jest.Mock
const mockPersonFindFirst = prisma.person.findFirst as jest.Mock
const mockRegistrationFindMany = prisma.registration.findMany as jest.Mock
const mockLogAudit = logAudit as jest.Mock

function makeRequest() {
  return new NextRequest("http://localhost/api/people/1/export")
}

function makeProps(id: string) {
  return { params: Promise.resolve({ id }) }
}

const mockPerson = {
  id: 1,
  firstName: "John",
  lastName: "Smith",
  email: "enc:john@example.com",
  emailHash: "hash-john",
  mobile: null,
  workPhone: null,
  homePhone: null,
  dateOfBirth: null,
  pastoralNotes: "enc:Some pastoral notes",
  emergencyContactName: "enc:Jane Smith",
  emergencyContactPhone: "enc:0400111222",
  family: { id: 1, name: "Smith Family" },
  transactions: [],
}

describe("GET /api/people/[id]/export", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    __resetRateLimit()
    mockPersonFindFirst.mockResolvedValue(mockPerson)
    mockRegistrationFindMany.mockResolvedValue([])
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest(), makeProps("1"))
    expect(res.status).toBe(401)
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("returns 403 for PASTOR", async () => {
    mockAuth.mockResolvedValue({ user: { role: "PASTOR", id: "2" } })
    const res = await GET(makeRequest(), makeProps("1"))
    expect(res.status).toBe(403)
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("returns 403 for VIEWER", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "3" } })
    const res = await GET(makeRequest(), makeProps("1"))
    expect(res.status).toBe(403)
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("returns 400 for non-numeric id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await GET(makeRequest(), makeProps("abc"))
    expect(res.status).toBe(400)
  })

  it("returns 400 for id of 0", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await GET(makeRequest(), makeProps("0"))
    expect(res.status).toBe(400)
  })

  it("returns 400 for id exceeding max int (2147483648)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await GET(makeRequest(), makeProps("2147483648"))
    expect(res.status).toBe(400)
  })

  it("returns 404 when person not found", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockPersonFindFirst.mockResolvedValue(null)
    const res = await GET(makeRequest(), makeProps("1"))
    expect(res.status).toBe(404)
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("scopes the lookup to non-archived people", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await GET(makeRequest(), makeProps("1"))
    expect(mockPersonFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 1, archivedAt: null }) })
    )
  })

  it("returns 404 for an archived person (findFirst yields null)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockPersonFindFirst.mockResolvedValue(null)
    const res = await GET(makeRequest(), makeProps("1"))
    expect(res.status).toBe(404)
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("returns 200 with JSON body and decrypts sensitive fields", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await GET(makeRequest(), makeProps("1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.person.id).toBe(1)
    expect(body.person.email).toBe("john@example.com")
    expect(body.person.pastoralNotes).toBe("Some pastoral notes")
    expect(body.person.emergencyContactName).toBe("Jane Smith")
    expect(body.person.emergencyContactPhone).toBe("0400111222")
  })

  it("decrypts dateOfBirth, mobile, workPhone and homePhone", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockPersonFindFirst.mockResolvedValue({
      ...mockPerson,
      dateOfBirth: "enc:1980-01-15",
      mobile: "enc:0400999888",
      workPhone: "enc:0298765432",
      homePhone: "enc:0212345678",
    })
    const res = await GET(makeRequest(), makeProps("1"))
    const body = await res.json()
    expect(body.person.dateOfBirth).toBe("1980-01-15")
    expect(body.person.mobile).toBe("0400999888")
    expect(body.person.workPhone).toBe("0298765432")
    expect(body.person.homePhone).toBe("0212345678")
  })

  it("decrypts encrypted family fields", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockPersonFindFirst.mockResolvedValue({
      ...mockPerson,
      family: {
        id: 1,
        name: "Smith Family",
        address: "enc:1 Church St",
        suburb: "enc:Springfield",
        homePhone: "enc:0249991234",
        notes: "enc:family notes",
      },
    })
    const res = await GET(makeRequest(), makeProps("1"))
    const body = await res.json()
    expect(body.person.family.address).toBe("1 Church St")
    expect(body.person.family.suburb).toBe("Springfield")
    expect(body.person.family.homePhone).toBe("0249991234")
    expect(body.person.family.notes).toBe("family notes")
  })

  it("audit exportedFields lists the newly decrypted fields", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await GET(makeRequest(), makeProps("1"))
    const exported = mockLogAudit.mock.calls[0][4].exportedFields
    expect(exported).toEqual(
      expect.arrayContaining(["dateOfBirth", "mobile", "workPhone", "homePhone", "familyFields"])
    )
  })

  it("matches registrations by the email blind index, not a full-table scan", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockRegistrationFindMany.mockResolvedValue([
      { id: 1, email: "enc:john@example.com", phone: "enc:0400111222", items: [] },
    ])
    const res = await GET(makeRequest(), makeProps("1"))
    const body = await res.json()
    // The query filters on the person's emailHash (indexed) — no take cap, no
    // client-side decrypt-and-compare over the whole registrations table.
    expect(mockRegistrationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { emailHash: "hash-john" } })
    )
    const callArg = mockRegistrationFindMany.mock.calls[0][0]
    expect(callArg.take).toBeUndefined()
    expect(body.registrations).toHaveLength(1)
    expect(body.registrations[0].id).toBe(1)
    expect(body.registrations[0].email).toBe("john@example.com")
    expect(body.registrations[0].phone).toBe("0400111222")
  })

  it("does not query registrations when the person has no email", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockPersonFindFirst.mockResolvedValue({ ...mockPerson, email: null, emailHash: null })
    const res = await GET(makeRequest(), makeProps("1"))
    const body = await res.json()
    expect(mockRegistrationFindMany).not.toHaveBeenCalled()
    expect(body.registrations).toHaveLength(0)
  })

  it("calls logAudit with PERSON_EXPORTED action and correct person id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await GET(makeRequest(), makeProps("1"))
    expect(res.status).toBe(200)
    expect(mockLogAudit).toHaveBeenCalledTimes(1)
    expect(mockLogAudit).toHaveBeenCalledWith(
      1,
      "PERSON_EXPORTED",
      "Person",
      1,
      expect.any(Object),
      "unknown"
    )
  })

  it("passes client IP to logAudit when x-forwarded-for header is present", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const req = new NextRequest("http://localhost/api/people/1/export", {
      headers: { "x-forwarded-for": "203.0.113.5" },
    })
    await GET(req, makeProps("1"))
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.any(Number),
      "PERSON_EXPORTED",
      "Person",
      1,
      expect.any(Object),
      "203.0.113.5"
    )
  })
})
