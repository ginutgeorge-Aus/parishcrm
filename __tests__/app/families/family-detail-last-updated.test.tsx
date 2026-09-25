/** @jest-environment node */

// the family detail page shows a "last updated by" line to editors only.
// Asserts the gating — getFamilyLastUpdate runs for editors, not for VIEWER.

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { findUnique: jest.fn() },
    transaction: { findMany: jest.fn() },
    familyUpdateSubmission: { findFirst: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/actions/familyActivity", () => ({
  getFamilyLastUpdate: jest.fn(),
}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))

import { notFound } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getFamilyLastUpdate } from "@/lib/actions/familyActivity"
import FamilyDetailPage from "@/app/(dashboard)/families/[id]/page"

const mockAuth = auth as jest.Mock
const mockFamilyFindUnique = prisma.family.findUnique as jest.Mock
const mockTransactionFindMany = prisma.transaction.findMany as jest.Mock
const mockFindFirst = prisma.familyUpdateSubmission.findFirst as jest.Mock
const mockGetLastUpdate = getFamilyLastUpdate as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockFamilyFindUnique.mockResolvedValue({ id: 1, name: "Smith Family", people: [] })
  mockTransactionFindMany.mockResolvedValue([])
  mockFindFirst.mockResolvedValue(null)
  mockGetLastUpdate.mockResolvedValue({
    at: new Date("2026-06-27T04:40:00.000Z"), actorLabel: "Alex Admin", kind: "admin",
  })
})

const makeProps = (id = "1") => ({ params: Promise.resolve({ id }) })

it("loads the last-updated line for an editor (ADMIN)", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  await FamilyDetailPage(makeProps())
  expect(mockGetLastUpdate).toHaveBeenCalledWith(1)
})

it("does not load the last-updated line for a VIEWER", async () => {
  mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "2" } })
  await FamilyDetailPage(makeProps())
  expect(mockGetLastUpdate).not.toHaveBeenCalled()
})

it("notFound for a non-numeric id", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  await expect(FamilyDetailPage(makeProps("abc"))).rejects.toThrow("NOT_FOUND")
  expect(notFound).toHaveBeenCalled()
  expect(mockFamilyFindUnique).not.toHaveBeenCalled()
})
