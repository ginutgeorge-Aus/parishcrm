/** @jest-environment node */

// EditFamilyPage loaded a family by id without checking archivedAt, so
// an archived (soft-deleted) family stayed editable via a direct /edit URL.
// Asserts the guard: archived families 404 instead of rendering the form.

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/actions/family", () => ({
  updateFamily: jest.fn(),
}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))

import { notFound } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import EditFamilyPage from "@/app/(dashboard)/families/[id]/edit/page"

const mockAuth = auth as jest.Mock
const mockFamilyFindUnique = prisma.family.findUnique as jest.Mock
const mockNotFound = notFound as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
})

const makeProps = (id = "5") => ({ params: Promise.resolve({ id }) })

it("404s for an archived family instead of rendering the edit form", async () => {
  mockFamilyFindUnique.mockResolvedValue({
    id: 5,
    name: "Smith",
    archivedAt: new Date("2020-01-01"),
    address: null,
    suburb: null,
    state: null,
    postcode: null,
    homePhone: null,
    notes: null,
    monthlyDues: null,
  })

  await expect(EditFamilyPage(makeProps())).rejects.toThrow("NOT_FOUND")
  expect(mockNotFound).toHaveBeenCalled()
})

it("renders normally for a non-archived family", async () => {
  mockFamilyFindUnique.mockResolvedValue({
    id: 5,
    name: "Smith",
    archivedAt: null,
    address: null,
    suburb: null,
    state: null,
    postcode: null,
    homePhone: null,
    notes: null,
    monthlyDues: null,
  })

  await expect(EditFamilyPage(makeProps())).resolves.toBeTruthy()
  expect(mockNotFound).not.toHaveBeenCalled()
})
