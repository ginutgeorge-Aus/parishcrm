/** @jest-environment node */
import { POST } from "../route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { parseCsv } from "@/lib/csv"
import { rateLimit } from "@/lib/rateLimit"
import { exceedsBodyLimit } from "@/lib/bodyLimit"

// Locks in the /api/import/families/check gates (401/403/429/413/400) and the
// duplicate-flagging that/ hardened: a memberNo carried by two
// different CSV families, and a memberNo/name already in the DB, must both be
// surfaced — including memberNos that collide with Object.prototype keys.

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/csv", () => ({ parseCsv: jest.fn() }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/bodyLimit", () => ({ exceedsBodyLimit: jest.fn(() => false) }))
jest.mock("@/lib/prisma", () => ({
  prisma: { family: { findMany: jest.fn() } },
}))

const mockAuth = auth as jest.Mock
const mockParse = parseCsv as jest.Mock

function personRow(name: string, first: string, memberNo: string | null = null) {
  return {
    family: { name, memberNo, address: null, suburb: null, state: null, postcode: null },
    person: { firstName: first, lastName: "X", role: "HEAD", classification: "MEMBER" },
  }
}

function req(fileText = "csv") {
  const file = { size: 10, text: async () => fileText }
  return {
    headers: { get: () => null },
    formData: async () => ({ get: (k: string) => (k === "file" ? file : null) }),
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(rateLimit as jest.Mock).mockReturnValue(true)
  ;(exceedsBodyLimit as jest.Mock).mockReturnValue(false)
  ;(prisma.family.findMany as jest.Mock).mockResolvedValue([])
  mockParse.mockReturnValue({ rows: [], errors: [] })
})

it("401 when unauthenticated", async () => {
  mockAuth.mockResolvedValue(null)
  const res = await POST(req())
  expect(res.status).toBe(401)
})

it("403 when the session is not ADMIN", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
  const res = await POST(req())
  expect(res.status).toBe(403)
})

it("429 when rate-limited", async () => {
  ;(rateLimit as jest.Mock).mockReturnValue(false)
  const res = await POST(req())
  expect(res.status).toBe(429)
})

it("413 when the body exceeds the size budget", async () => {
  ;(exceedsBodyLimit as jest.Mock).mockReturnValue(true)
  const res = await POST(req())
  expect(res.status).toBe(413)
})

it("400 when no file is attached", async () => {
  const r = {
    headers: { get: () => null },
    formData: async () => ({ get: () => null }),
  } as never
  const res = await POST(r)
  expect(res.status).toBe(400)
})

it("413 and no DB query when the row count exceeds the cap", async () => {
  const rows = Array.from({ length: 5001 }, (_, i) => personRow(`Fam${i}`, "A"))
  mockParse.mockReturnValue({ rows, errors: [] })
  const res = await POST(req())
  expect(res.status).toBe(413)
  expect(prisma.family.findMany).not.toHaveBeenCalled()
})

it("flags a memberNo shared by two distinct CSV families", async () => {
  mockParse.mockReturnValue({
    rows: [personRow("Smith", "A", "M1"), personRow("Jones", "B", "M1")],
    errors: [],
  })
  const res = await POST(req())
  const body = await res.json()
  expect(new Set(body.duplicates)).toEqual(new Set(["Smith", "Jones"]))
})

it("flags a CSV family whose name already exists in the DB", async () => {
  mockParse.mockReturnValue({ rows: [personRow("Smith", "A")], errors: [] })
  ;(prisma.family.findMany as jest.Mock)
    .mockResolvedValueOnce([{ name: "Smith" }]) // matchedByName
    .mockResolvedValueOnce([]) // matchedByMemberNo
  const res = await POST(req())
  const body = await res.json()
  expect(body.duplicates).toContain("Smith")
})

it("does not crash on a memberNo that collides with an Object.prototype key", async () => {
  mockParse.mockReturnValue({
    rows: [personRow("Smith", "A", "__proto__"), personRow("Jones", "B", "__proto__")],
    errors: [],
  })
  const res = await POST(req())
  const body = await res.json()
  expect(new Set(body.duplicates)).toEqual(new Set(["Smith", "Jones"]))
})
