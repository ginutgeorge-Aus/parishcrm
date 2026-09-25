/** @jest-environment node */
import { POST } from "../route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { parseCsv } from "@/lib/csv"
import { rateLimit } from "@/lib/rateLimit"
import { exceedsBodyLimit } from "@/lib/bodyLimit"

// Locks in the /api/import/families POST gates (401/403/429/413) plus the
// batch-import behaviour: the row cap, one upsert per distinct family,
// re-import skipping existing members (never overwrite,/), and
// per-row error reporting on a family upsert failure ( PII-free detail).

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/logger", () => ({ logger: { warn: jest.fn(), error: jest.fn() } }))
jest.mock("@/lib/csv", () => ({ parseCsv: jest.fn() }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/bodyLimit", () => ({ exceedsBodyLimit: jest.fn(() => false) }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  hmacEmail: jest.fn((v: string) => `eh:${v}`),
  hmacMobile: jest.fn((v: string) => `mh:${v}`),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { upsert: jest.fn() },
    person: { findMany: jest.fn(), createMany: jest.fn() },
  },
}))

const mockAuth = auth as jest.Mock
const mockParse = parseCsv as jest.Mock

function row(name: string, first: string) {
  return {
    family: { name, memberNo: null, address: null, suburb: null, state: null, postcode: null },
    person: {
      firstName: first,
      lastName: "X",
      role: "HEAD",
      classification: "MEMBER",
      dateOfBirth: null,
      gender: null,
      email: null,
      mobile: null,
    },
  }
}

function req() {
  const file = { size: 10, text: async () => "csv" }
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
  mockParse.mockReturnValue({ rows: [], errors: [] })
  ;(prisma.family.upsert as jest.Mock).mockResolvedValue({ id: 10 })
  ;(prisma.person.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.person.createMany as jest.Mock).mockResolvedValue({ count: 0 })
})

it("401 when unauthenticated", async () => {
  mockAuth.mockResolvedValue(null)
  expect((await POST(req())).status).toBe(401)
})

it("403 when the session is not ADMIN", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
  expect((await POST(req())).status).toBe(403)
})

it("429 when rate-limited", async () => {
  ;(rateLimit as jest.Mock).mockReturnValue(false)
  expect((await POST(req())).status).toBe(429)
})

it("413 when the row cap is exceeded", async () => {
  mockParse.mockReturnValue({ rows: Array.from({ length: 5001 }, (_, i) => row("F", `P${i}`)), errors: [] })
  const res = await POST(req())
  expect(res.status).toBe(413)
  expect(prisma.family.upsert).not.toHaveBeenCalled()
})

it("upserts each distinct family once, not once per member", async () => {
  mockParse.mockReturnValue({ rows: [row("Smith", "A"), row("Smith", "B")], errors: [] })
  ;(prisma.person.createMany as jest.Mock).mockResolvedValue({ count: 2 })
  const res = await POST(req())
  const body = await res.json()
  expect(prisma.family.upsert).toHaveBeenCalledTimes(1)
  expect(body).toMatchObject({ imported: 2, skipped: 0 })
})

it("scopes the upsert match to non-archived families", async () => {
  mockParse.mockReturnValue({ rows: [row("Smith", "A")], errors: [] })
  await POST(req())
  expect(prisma.family.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ where: { name: "Smith", archivedAt: null } })
  )
})

it("surfaces a row error instead of resurrecting members when the name collides with an archived family", async () => {
  mockParse.mockReturnValue({ rows: [row("Smith", "A")], errors: [] })
  // Name is globally unique — scoping the upsert match to archivedAt: null
  // means an archived "Smith" no longer matches, so the create() attempt
  // hits the unique constraint instead of silently resurrecting a member
  // under the frozen archived family.
  ;(prisma.family.upsert as jest.Mock).mockRejectedValue(
    new Error("Unique constraint failed on the fields: (`name`)")
  )
  const res = await POST(req())
  const body = await res.json()
  expect(body.imported).toBe(0)
  expect(body.errors[0].message).toBe("A X: duplicate record")
  expect(prisma.person.createMany).not.toHaveBeenCalled()
})

it("skips a member that already exists — never overwrites", async () => {
  mockParse.mockReturnValue({ rows: [row("Smith", "A"), row("Smith", "B")], errors: [] })
  ;(prisma.person.findMany as jest.Mock).mockResolvedValue([{ familyId: 10, firstName: "A", lastName: "X" }])
  ;(prisma.person.createMany as jest.Mock).mockResolvedValue({ count: 1 })
  const res = await POST(req())
  const body = await res.json()
  expect(body).toMatchObject({ imported: 1, skipped: 1 })
  const createArg = (prisma.person.createMany as jest.Mock).mock.calls[0][0].data
  expect(createArg.map((d: { firstName: string }) => d.firstName)).toEqual(["B"])
})

it("reports a PII-free row error when a family upsert fails on a memberNo clash", async () => {
  mockParse.mockReturnValue({ rows: [row("Smith", "A")], errors: [] })
  ;(prisma.family.upsert as jest.Mock).mockRejectedValue(
    new Error("Unique constraint failed on the fields: (`memberNo`)")
  )
  const res = await POST(req())
  const body = await res.json()
  expect(body.imported).toBe(0)
  expect(body.errors[0].message).toBe("A X: member number already in use")
  expect(prisma.person.createMany).not.toHaveBeenCalled()
})
