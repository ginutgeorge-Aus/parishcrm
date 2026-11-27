/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { membershipApplication: { findUnique: jest.fn() } },
}))
jest.mock("@/lib/crypto", () => ({ decrypt: jest.fn(() => "data:image/png;base64,sig") }))
jest.mock("@/lib/membership", () => ({
  overseasFieldLabels: jest.requireActual("@/lib/membership").overseasFieldLabels,
  readPayload: jest.fn(() => ({
    personal: { name: "Jane Doe" },
    spouse: null,
    children: [],
    dependents: [],
  })),
  buildNotesBlock: jest.fn(() => ""),
}))
jest.mock("@/lib/actions/membership", () => ({ findMembershipMatches: jest.fn().mockResolvedValue([]) }))
jest.mock("@/app/(dashboard)/memberships/[id]/ReviewPanel", () => ({ ReviewPanel: () => null }))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { readPayload, buildNotesBlock } from "@/lib/membership"
import { decrypt } from "@/lib/crypto"
import MembershipDetailPage from "@/app/(dashboard)/memberships/[id]/page"

const mockAuth = auth as jest.Mock
const mockFindUnique = prisma.membershipApplication.findUnique as jest.Mock
const mockReadPayload = readPayload as jest.Mock

const props = { params: Promise.resolve({ id: "1" }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
})

test("status badge shows a humanized label, not the raw uppercase enum", async () => {
  mockFindUnique.mockResolvedValue({
    id: 1,
    status: "PENDING",
    payload: "{}",
    signature: "enc:sig",
    monthlyDues: null,
    placeSigned: null,
    signedDate: null,
  })
  const html = renderToStaticMarkup(await MembershipDetailPage(props))
  expect(html).toContain(">Pending<")
  expect(html).not.toContain(">PENDING<")
})

test("renders a redacted state for a retention-purged application without parsing the emptied payload", async () => {
  mockFindUnique.mockResolvedValue({
    id: 1,
    status: "APPROVED",
    payload: "", // scrubbed by the retention purge — readPayload would throw on JSON.parse("")
    signature: "",
    anonymizedAt: new Date("2026-01-01T00:00:00Z"),
    monthlyDues: null,
    placeSigned: null,
    signedDate: null,
  })

  const html = renderToStaticMarkup(await MembershipDetailPage(props))

  expect(html).toMatch(/redacted|removed under|retention/i)
  // The decision is still shown; the emptied payload is never parsed.
  expect(html).toContain(">Approved<")
  expect(mockReadPayload).not.toHaveBeenCalled()
})

const reviewedBase = {
  id: 1,
  payload: "{}",
  signature: "enc:sig",
  monthlyDues: null,
  placeSigned: null,
  signedDate: null,
  reviewedAt: new Date("2026-03-05T10:00:00Z"),
  reviewedBy: { name: "Pat Reviewer" },
  linkedFamily: null,
  reviewNote: null,
}

test("approved application shows who approved it, when, and the family it joined", async () => {
  mockFindUnique.mockResolvedValue({
    ...reviewedBase,
    status: "APPROVED",
    linkedFamily: { id: 7, name: "Doe Family" },
    reviewNote: "enc:welcome",
  })
  // First decrypt call is the signature; the second is the stored (encrypted) review note.
  ;(decrypt as jest.Mock).mockReturnValueOnce("data:image/png;base64,sig").mockReturnValueOnce("Welcome aboard")
  const html = renderToStaticMarkup(await MembershipDetailPage(props))
  expect(html).toContain('aria-label="Review outcome"')
  expect(html).toContain("Approved")
  expect(html).toContain("/families/7")
  expect(html).toContain("Doe Family")
  expect(html).toContain("by Pat Reviewer")
  expect(html).toContain("Note: Welcome aboard")
  expect(html).not.toContain("enc:welcome")
})

test("rejected application shows the outcome without a family link or reviewer name when absent", async () => {
  mockFindUnique.mockResolvedValue({ ...reviewedBase, status: "REJECTED", reviewedBy: null })
  const html = renderToStaticMarkup(await MembershipDetailPage(props))
  expect(html).toContain("Rejected")
  expect(html).not.toContain("/families/")
  expect(html).not.toContain(" by ")
  expect(html).not.toContain("Note:")
})

test("pending application shows no review outcome section", async () => {
  mockFindUnique.mockResolvedValue({ ...reviewedBase, status: "PENDING", reviewedAt: null })
  const html = renderToStaticMarkup(await MembershipDetailPage(props))
  expect(html).not.toContain("Review outcome")
})

test("shows the Other details section only when there are notes", async () => {
  mockFindUnique.mockResolvedValue({ ...reviewedBase, status: "PENDING", reviewedAt: null })
  ;(buildNotesBlock as jest.Mock).mockReturnValueOnce("Baptised 2001")
  const withNotes = renderToStaticMarkup(await MembershipDetailPage(props))
  expect(withNotes).toContain("Other details")
  expect(withNotes).toContain("Baptised 2001")
  const without = renderToStaticMarkup(await MembershipDetailPage(props))
  expect(without).not.toContain("Other details")
})
