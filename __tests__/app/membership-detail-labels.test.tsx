/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { membershipApplication: { findUnique: jest.fn() } },
}))
jest.mock("@/lib/crypto", () => ({ decrypt: jest.fn(() => "data:image/png;base64,sig") }))
jest.mock("@/lib/membership", () => ({
  overseasFieldLabels: jest.requireActual("@/lib/membership").overseasFieldLabels,
  readPayload: jest.fn(() => ({
    personal: { name: "Jane Doe", maritalStatus: "Married" },
    spouse: null,
    children: [],
    dependents: [{ name: "Sam Example", sex: "M", dateOfBirth: "2010-01-01", relationship: "Nephew" }],
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
import MembershipDetailPage from "@/app/(dashboard)/memberships/[id]/page"

test("detail labels use sentence case", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue({
    id: 1,
    status: "PENDING",
    payload: "{}",
    signature: "enc:sig",
    monthlyDues: { toString: () => "25.00" },
    placeSigned: null,
    signedDate: null,
    anonymizedAt: null,
  })
  const html = renderToStaticMarkup(await MembershipDetailPage({ params: Promise.resolve({ id: "1" }) }))
  expect(html).toContain("Marital status")
  expect(html).toContain("Other dependents")
  expect(html).toContain("Monthly subscription")
  expect(html).toContain("$25.00")
  expect(html).not.toContain("Marital Status")
  expect(html).not.toContain("Other Dependents")
  expect(html).not.toContain("Monthly Subscription")
})
