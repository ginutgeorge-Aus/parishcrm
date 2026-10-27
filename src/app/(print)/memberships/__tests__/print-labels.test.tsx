/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"
import MembershipPrintPage from "../[id]/print/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: () => 1 }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/crypto", () => ({ decrypt: (v: string) => v.replace(/^enc:/, "") }))
jest.mock("next/headers", () => ({ headers: () => Promise.resolve(new Map()) }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))
jest.mock("@/lib/prisma", () => ({ prisma: { membershipApplication: { findUnique: jest.fn() } } }))
jest.mock("@/lib/letterSettings", () => ({ getLetterSettings: jest.fn().mockResolvedValue({ signerTitle: "Vicar" }) }))
jest.mock("@/lib/membershipSettings", () => ({
  getMembershipSettings: jest.fn().mockResolvedValue({ parishFields: false, minDues: null, homeAddressLabel: "", arrivalDateLabel: "" }),
}))

const payload = {
  personal: { name: "John Miller", gender: "MALE", dateOfBirth: "1980-01-02", email: "john@example.com", mobile: "0400111222",
    address: "1 Example St", suburb: "Sampletown", state: "NSW", postcode: "2000", qualificationProfession: "Engineer",
    motherParish: null, addressInIndia: null, dateOfArrivalNsw: null, maritalStatus: "MARRIED", transferCertFurnished: null },
  spouse: { name: "Mary Miller", dateOfBirth: "1982-05-06", dateOfMarriage: "2005-06-07", parish: null, working: true, email: "mary@example.com" },
  children: [{ name: "Anna Miller", sex: "F", dateOfBirth: "2010-01-01", occupation: null, phoneEmail: null }],
  dependents: [{ name: "Sam", sex: "M", dateOfBirth: "2000-01-01", relationship: "Nephew", phoneEmail: null }],
  relativesInAustralia: [{ name: "Sam", place: "Sydney", relationship: "Brother", phoneEmail: null }],
  subscription: { monthlyAmount: 80 },
  declaration: { place: "Springfield", date: "2026-07-09" },
}

it("prints sentence-case labels with A-F section lettering", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue({
    id: 5, payload: JSON.stringify(payload), signature: "data:image/png;base64,ABCD",
    monthlyDues: "80", placeSigned: "Springfield", signedDate: new Date("2026-07-09"),
  })
  const html = renderToStaticMarkup(await MembershipPrintPage({ params: Promise.resolve({ id: "5" }) }))
  for (const label of [
    "A. Personal particulars", "Residential address", "B. Details of family (spouse)", "Name of spouse",
    "Spouse e-mail ID", "C. Name of children", "D. Other dependents", "E. Any other relatives in Australia", "Membership registration no.", "F. Subscription &amp; declaration", "Book no.",
  ]) expect(html).toContain(label)
  for (const old of ["Personal Particulars", "Residential Address", "Details of Family", "Name of Spouse", "Spouse E-mail", "Name of Children", "Other Relatives", "Registration No", "Other Dependents", "Subscription &amp; Declaration", "Book No"]) {
    expect(html).not.toContain(old)
  }
})
