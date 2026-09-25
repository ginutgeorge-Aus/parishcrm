/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v) }))
jest.mock("@/lib/prisma", () => ({
  prisma: { familyUpdateSubmission: { findUnique: jest.fn() } },
}))
jest.mock("@/lib/familyUpdateDiff", () => ({ diffFamilyUpdate: jest.fn() }))
jest.mock("@/components/family-update/SubmissionReview", () => ({
  SubmissionReview: () => null,
}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
}))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { safeDecrypt } from "@/lib/crypto"
import { prisma } from "@/lib/prisma"
import { diffFamilyUpdate } from "@/lib/familyUpdateDiff"
import SubmissionDetail from "@/app/(dashboard)/families/updates/[id]/page"

const mockAuth = auth as jest.Mock
const mockFindUnique = prisma.familyUpdateSubmission.findUnique as jest.Mock
const mockDiff = diffFamilyUpdate as jest.Mock

const validPayload = {
  family: { address: null, suburb: null, state: null, postcode: null, homePhone: null, marriageDate: null },
  members: [{ firstName: "Jo", lastName: "Smith" }],
}

const sub = {
  id: 9,
  status: "PENDING",
  payload: validPayload,
  family: { id: 1, name: "Smith", people: [] },
}

const props = { params: Promise.resolve({ id: "9" }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  mockFindUnique.mockResolvedValue(sub)
  mockDiff.mockReturnValue({
    family: [{ field: "Address", from: "Old St", to: "New St", changed: true }],
    members: [{ label: "Jo Smith", isNew: false, fields: [{ field: "Mobile", from: "1", to: "2", changed: true }] }],
  })
})

test("sub-section headings are h3, stepping down from the page's h2", async () => {
  const html = renderToStaticMarkup(await SubmissionDetail(props))

  expect(html).toMatch(/<h2[^>]*>Smith — proposed updates<\/h2>/)
  expect(html).toMatch(/<h3[^>]*>Family contact<\/h3>/)
  expect(html).toMatch(/<h3[^>]*>Jo Smith/)
})


test.each(["ADMIN", "PASTOR", "OFFICE_ADMIN"])("hides archived submissions from %s before decrypting", async (role) => {
  mockAuth.mockResolvedValue({ user: { role, id: "1" } })
  mockFindUnique.mockResolvedValue({ ...sub, payload: "enc:private", family: { ...sub.family, archivedAt: new Date() } })
  await expect(SubmissionDetail(props)).rejects.toThrow("NOT_FOUND")
  expect(safeDecrypt).not.toHaveBeenCalled()
  expect(mockDiff).not.toHaveBeenCalled()
})
