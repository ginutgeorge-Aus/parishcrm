jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { membershipApplication: { findUnique: jest.fn() } },
}))
jest.mock("@/lib/crypto", () => ({ decrypt: jest.fn(() => "data:image/png;base64,sig") }))
jest.mock("@/lib/membership", () => ({
  overseasFieldLabels: jest.requireActual("@/lib/membership").overseasFieldLabels,
  readPayload: jest.fn(() => ({
    personal: { name: "Jane Doe", maritalStatus: "Married", dateOfBirth: "1980-01-01", qualificationProfession: "Teacher" },
    spouse: { name: "John Doe", dateOfBirth: "1979-01-01", dateOfMarriage: "2005-01-01" },
    children: [],
    dependents: [{ name: "Sam Example", sex: "M", dateOfBirth: "2010-01-01", relationship: "Nephew" }],
  })),
  buildNotesBlock: jest.fn(() => ""),
}))
// The real module pulls in next/cache, which needs TextEncoder in jsdom.
jest.mock("@/lib/membershipSettings", () => ({
  getMembershipSettings: jest.fn().mockResolvedValue({
    parishFields: false,
    homeAddressLabel: "",
    arrivalDateLabel: "",
  }),
}))
jest.mock("@/lib/actions/membership", () => ({ findMembershipMatches: jest.fn().mockResolvedValue([]) }))
jest.mock("@/app/(dashboard)/memberships/[id]/ReviewPanel", () => ({ ReviewPanel: () => null }))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))

import { render, screen } from "@testing-library/react"
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
  render(await MembershipDetailPage({ params: Promise.resolve({ id: "1" }) }))

  for (const heading of ["Other dependents", "Subscription & declaration"]) {
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument()
  }
  for (const label of [
    "Marital status",
    "Monthly subscription",
    "Qualification & profession",
    "Date of marriage",
  ]) {
    expect(screen.getByText(label)).toBeInTheDocument()
  }
  expect(screen.getAllByText("Date of birth")).toHaveLength(2)
  expect(screen.getByText("$25.00")).toBeInTheDocument()
})
