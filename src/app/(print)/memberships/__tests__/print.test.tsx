/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"
import MembershipPrintPage from "../[id]/print/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getMembershipSettings } from "@/lib/membershipSettings"
import { logAudit } from "@/lib/audit"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: () => 1 }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/crypto", () => ({ decrypt: (v: string) => v.replace(/^enc:/, "") }))
jest.mock("next/headers", () => ({ headers: () => Promise.resolve(new Map([["x-forwarded-for", "6.6.6.6, 203.0.113.9"]])) }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("REDIRECT")
  }),
  notFound: jest.fn(() => {
    throw new Error("NOT_FOUND")
  }),
}))
jest.mock("@/lib/prisma", () => ({ prisma: { membershipApplication: { findUnique: jest.fn() } } }))
jest.mock("@/lib/letterSettings", () => ({ getLetterSettings: jest.fn().mockResolvedValue({ signerTitle: "Vicar" }) }))
jest.mock("@/lib/membershipSettings", () => ({
  getMembershipSettings: jest.fn().mockResolvedValue({ parishFields: false, minDues: null, homeAddressLabel: "", arrivalDateLabel: "" }),
}))

const payload = {
  personal: { name: "John Miller", gender: "MALE", dateOfBirth: "1980-01-02", email: "john@example.com", mobile: "0400111222",
    address: "1 Example St", suburb: "Sampletown", state: "NSW", postcode: "2000", qualificationProfession: "Engineer",
    motherParish: "Grace", addressInIndia: null, dateOfArrivalNsw: null, maritalStatus: "MARRIED", transferCertFurnished: true },
  spouse: null,
  children: [],
  dependents: [],
  relativesInAustralia: [],
  subscription: { monthlyAmount: 80 },
  declaration: { place: "Springfield", date: "2026-07-09" },
}

beforeEach(() => jest.clearAllMocks())

it("renders the completed form with the applicant name and signature for an ADMIN", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue({
    id: 5,
    payload: JSON.stringify(payload),
    signature: "data:image/png;base64,ABCD",
    monthlyDues: "80",
    placeSigned: "Springfield",
    signedDate: new Date("2026-07-09"),
  })

  const el = await MembershipPrintPage({ params: Promise.resolve({ id: "5" }) })
  const html = renderToStaticMarkup(el)
  expect(html).toContain("MEMBERSHIP REGISTRATION FORM")
  expect(html).toContain("John Miller")
  expect(html).toContain("data:image/png;base64,ABCD")
  expect(html).toContain("FOR OFFICE USE ONLY")
  // Audit row carries the proxy-appended client IP.
  expect(logAudit).toHaveBeenCalledWith(1, "MEMBERSHIP_PRINTED", "MembershipApplication", 5, undefined, "203.0.113.9")
  expect(html).toContain("Signature of the Vicar")
  // Parish toggle off, but stored value still shown under the generic label.
  expect(html).toContain("Previous church")
  expect(html).not.toContain("Mother Parish")
  expect(html).not.toContain("Transfer letter / NOC")
  // Overseas-field labels blank + no stored values → rows hidden entirely.
  expect(html).not.toContain("Address in India")
  expect(html).not.toContain("Home-country address")
  expect(html).not.toContain("Date of arrival")
})

it("shows overseas fields under the configured labels", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(getMembershipSettings as jest.Mock).mockResolvedValueOnce({ parishFields: false, minDues: null, homeAddressLabel: "Address in India", arrivalDateLabel: "Date of arrival in Australia" })
  ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue({
    id: 5,
    payload: JSON.stringify({ ...payload, personal: { ...payload.personal, addressInIndia: "Chennai" } }),
    signature: "data:image/png;base64,ABCD",
    monthlyDues: "80",
    placeSigned: "Springfield",
    signedDate: new Date("2026-07-09"),
  })

  const html = renderToStaticMarkup(await MembershipPrintPage({ params: Promise.resolve({ id: "5" }) }))
  expect(html).toContain("Address in India")
  expect(html).toContain("Chennai")
  expect(html).toContain("Date of arrival in Australia")
})

it("redirects a VIEWER", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "3", role: "VIEWER" } })
  await expect(MembershipPrintPage({ params: Promise.resolve({ id: "5" }) })).rejects.toThrow("REDIRECT")
})

it("404s a retention-purged application instead of 500-ing on the emptied payload", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue({
    id: 5, payload: "", signature: "", anonymizedAt: new Date("2026-01-01"),
    monthlyDues: null, placeSigned: null, signedDate: null,
  })
  await expect(MembershipPrintPage({ params: Promise.resolve({ id: "5" }) })).rejects.toThrow("NOT_FOUND")
})
