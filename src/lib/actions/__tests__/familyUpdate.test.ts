/** @jest-environment node */
import { updateFamily } from "@/lib/actions/family"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { family: { findUnique: jest.fn(), updateMany: jest.fn() } },
}))

const mockAuth = auth as jest.Mock
const findUnique = prisma.family.findUnique as jest.Mock
const updateMany = prisma.family.updateMany as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
})

function fd() {
  const f = new FormData()
  f.set("name", "Some Family")
  return f
}

it("blocks updating a soft-archived family", async () => {
  findUnique.mockResolvedValue({ id: 5, archivedAt: new Date("2020-01-01") })
  const r = await updateFamily(5, undefined, fd())
  expect(r).toEqual({ error: "Not found" })
  expect(updateMany).not.toHaveBeenCalled()
})

it("returns not-found for a missing family", async () => {
  findUnique.mockResolvedValue(null)
  const r = await updateFamily(99, undefined, fd())
  expect(r).toEqual({ error: "Not found" })
  expect(updateMany).not.toHaveBeenCalled()
})

it("rejects a non-editor role before any DB read", async () => {
  mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "2" } })
  const r = await updateFamily(5, undefined, fd())
  expect(r).toEqual({ error: "Unauthorized" })
  expect(findUnique).not.toHaveBeenCalled()
})
