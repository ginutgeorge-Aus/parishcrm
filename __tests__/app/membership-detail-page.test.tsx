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
import { readPayload } from "@/lib/membership"
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
