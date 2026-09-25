/** @jest-environment node */

// the add-member page loaded a family by id without checking
// archivedAt, so a canEdit role with no /families/archived access
// (OFFICE_ADMIN) could reach /families/{archivedId}/people/new directly and
// see the archived family's real name in the breadcrumb/heading. Mirrors
// family-edit-archived-guard.test.tsx.

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/actions/person", () => ({
  createPerson: jest.fn(),
}))
jest.mock("@/components/people/PersonForm", () => ({
  PersonForm: () => null,
}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))

import { notFound } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import NewPersonPage from "@/app/(dashboard)/families/[id]/people/new/page"

const mockAuth = auth as jest.Mock
const mockFamilyFindUnique = prisma.family.findUnique as jest.Mock
const mockNotFound = notFound as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
})

const makeProps = (id = "5") => ({ params: Promise.resolve({ id }) })

it("404s for an archived family instead of rendering the add-member form", async () => {
  mockFamilyFindUnique.mockResolvedValue({ id: 5, name: "Smith", archivedAt: new Date("2020-01-01") })

  await expect(NewPersonPage(makeProps())).rejects.toThrow("NOT_FOUND")
  expect(mockNotFound).toHaveBeenCalled()
})

it("renders normally for a non-archived family", async () => {
  mockFamilyFindUnique.mockResolvedValue({ id: 5, name: "Smith", archivedAt: null })

  await expect(NewPersonPage(makeProps())).resolves.toBeTruthy()
  expect(mockNotFound).not.toHaveBeenCalled()
})
