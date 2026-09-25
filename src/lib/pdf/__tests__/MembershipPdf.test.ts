/** @jest-environment node */
// No branding letterhead row in these tests — exercises the text-header
// fallback path (dedicated letterhead-fallback.test.ts covers the image path).
jest.mock("@/lib/branding", () => ({ getLetterheadAsset: jest.fn().mockResolvedValue(null) }))

import { renderMembershipPdf, type MembershipPdfModel } from "@/lib/pdf/MembershipPdf"

const payload: MembershipPdfModel["payload"] = {
  personal: {
    name: "John Miller", gender: "MALE", dateOfBirth: "1980-01-02", email: "john@example.com",
    mobile: "0400111222", address: "1 Example St", suburb: "Sampletown", state: "NSW", postcode: "2000",
    qualificationProfession: "Engineer", motherParish: "Grace", addressInIndia: "Chennai",
    dateOfArrivalNsw: "2015-03-01", maritalStatus: "MARRIED", transferCertFurnished: true,
  },
  spouse: { name: "Mary Miller", dateOfBirth: "1982-05-06", dateOfMarriage: "2005-06-07", parish: "Grace", working: true, email: "mary@example.com" },
  children: [{ name: "Anna Miller", sex: "F", dateOfBirth: "2010-01-01", occupation: null, phoneEmail: null }],
  dependents: [],
  relativesInAustralia: [{ name: "Sam", place: "Sydney", relationship: "Brother", phoneEmail: "sam@x.com" }],
  subscription: { monthlyAmount: 80 },
  declaration: { place: "Springfield", date: "2026-07-09" },
}

const base: MembershipPdfModel = {
  payload,
  signature: "data:image/png;base64,AAAA",
  churchName: "Example Church",
  churchAddress: "3 Example St, Sampletown, NSW, 2000",
  parishFields: true,
  homeAddressLabel: "Address in India",
  arrivalDateLabel: "Date of arrival in Australia",
  signerTitle: "Vicar",
}

it("renders with parish fields off and a blank signer title", async () => {
  const buf = await renderMembershipPdf({ ...base, parishFields: false, signerTitle: "" })
  expect(buf.subarray(0, 4).toString()).toBe("%PDF")
})

it("renders a non-empty PDF buffer", async () => {
  const buf = await renderMembershipPdf(base)
  expect(Buffer.isBuffer(buf)).toBe(true)
  expect(buf.length).toBeGreaterThan(1000)
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
})

it("renders without a spouse and with no optional sections", async () => {
  const buf = await renderMembershipPdf({
    ...base,
    payload: { ...payload, spouse: null, children: [], relativesInAustralia: [] },
  })
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
})

it("does not throw on a malformed signature data URL", async () => {
  const buf = await renderMembershipPdf({ ...base, signature: "not-a-data-url" })
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
})

it("renders a max-length (wrapping) configured overseas-field label", async () => {
  const buf = await renderMembershipPdf({ ...base, homeAddressLabel: "Permanent residential address in your country of origin before migrating here".padEnd(80, "x") })
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
})
