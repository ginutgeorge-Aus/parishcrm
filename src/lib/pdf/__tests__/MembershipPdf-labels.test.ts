/** @jest-environment node */
jest.mock("@/lib/branding", () => ({ getLetterheadAsset: jest.fn().mockResolvedValue(null) }))

import PDFDocument from "pdfkit"
import { renderMembershipPdf, type MembershipPdfModel } from "@/lib/pdf/MembershipPdf"

const model: MembershipPdfModel = {
  payload: {
    personal: {
      name: "John Miller", gender: "MALE", dateOfBirth: "1980-01-02", email: "john@example.com",
      mobile: "0400111222", address: "1 Example St", suburb: "Sampletown", state: "NSW", postcode: "2000",
      qualificationProfession: "Engineer", motherParish: "Grace", addressInIndia: null,
      dateOfArrivalNsw: null, maritalStatus: "MARRIED", transferCertFurnished: true,
    },
    spouse: { name: "Mary Miller", dateOfBirth: "1982-05-06", dateOfMarriage: "2005-06-07", parish: "Grace", working: true, email: "mary@example.com" },
    children: [{ name: "Anna Miller", sex: "F", dateOfBirth: "2010-01-01", occupation: null, phoneEmail: null }],
    dependents: [{ name: "Sam", sex: "M", dateOfBirth: "2000-01-01", relationship: "Nephew", phoneEmail: null }],
    relativesInAustralia: [{ name: "Sam", place: "Sydney", relationship: "Brother", phoneEmail: null }],
    subscription: { monthlyAmount: 80 },
    declaration: { place: "Springfield", date: "2026-07-09" },
  },
  signature: "data:image/png;base64,AAAA",
  churchName: "Example Church",
  churchAddress: "3 Example St",
  parishFields: true,
  homeAddressLabel: "",
  arrivalDateLabel: "",
  signerTitle: "Vicar",
}

it("draws sentence-case labels with A-F section lettering", async () => {
  const spy = jest.spyOn(PDFDocument.prototype, "text")
  await renderMembershipPdf(model)
  const drawn = spy.mock.calls.map((c) => String(c[0]))
  spy.mockRestore()
  for (const label of [
    "A. Personal particulars", "Residential address", "B. Details of family (spouse)", "Name of spouse",
    "Spouse e-mail ID", "C. Name of children", "D. Other dependents", "E. Any other relatives in Australia", "Membership registration no.", "F. Subscription & declaration", "Book no.",
  ]) {
    expect(drawn.some((t) => t.includes(label))).toBe(true)
  }
  for (const old of ["Personal Particulars", "Residential Address", "Details of Family", "Name of Spouse", "Spouse E-mail", "Name of Children", "Other Relatives", "Registration No", "Other Dependents", "Subscription & Declaration", "Book No"]) {
    expect(drawn.some((t) => t.includes(old))).toBe(false)
  }
})
