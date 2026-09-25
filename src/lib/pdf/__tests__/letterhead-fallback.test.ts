/** @jest-environment node */
// Task 5: PDF renderers must fetch the letterhead asset from the DB
// (getLetterheadAsset) instead of the hardcoded base64 module, and fall back
// to a neutral text header when no letterhead row exists.
jest.mock("@/lib/branding", () => ({ getLetterheadAsset: jest.fn() }))

import { getLetterheadAsset } from "@/lib/branding"
import { renderMembershipPdf, type MembershipPdfModel } from "@/lib/pdf/MembershipPdf"
import { renderDgrReceiptPdf } from "@/lib/pdf/DgrReceiptPdf"
import type { DgrPdfModel } from "@/lib/dgr"

const mockLetterhead = getLetterheadAsset as jest.Mock

// A minimal valid 1x1 transparent PNG — pdfkit's doc.image() parses real PNG
// headers, so an arbitrary placeholder string would throw.
const SMALL_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

const membershipModel: MembershipPdfModel = {
  payload: {
    personal: {
      name: "Test Member",
      gender: null,
      dateOfBirth: null,
      email: "test@example.com",
      mobile: null,
      address: "1 Test St",
      suburb: "Testville",
      state: "NSW",
      postcode: "2000",
      qualificationProfession: null,
      motherParish: null,
      addressInIndia: null,
      dateOfArrivalNsw: null,
      maritalStatus: null,
      transferCertFurnished: null,
    },
    spouse: null,
    children: [],
    dependents: [],
    relativesInAustralia: [],
    subscription: { monthlyAmount: 100 },
    declaration: { place: null, date: null },
  },
  signature: "",
  churchName: "Test Church",
  churchAddress: "1 Test St",
  parishFields: false,
  homeAddressLabel: "",
  arrivalDateLabel: "",
  signerTitle: "",
}

const dgrModel: DgrPdfModel = {
  churchName: "Test Church",
  churchAbn: "12345678901",
  churchAddress: "1 Test St",
  churchEmail: "test@example.com",
  receiptNo: "DGR-2026-001",
  issueDate: "01-07-2025",
  fyLabel: "2025–26",
  donorName: "Test Donor",
  documentTitle: "ANNUAL TAX-DEDUCTIBLE RECEIPT",
  totalDonationsLabel: "TOTAL TAX-DEDUCTIBLE DONATIONS",
  legalLines: [
    "Test Church is endorsed as a Deductible Gift Recipient (DGR) under Item 1 of the table in section 30-15 of the Income Tax Assessment Act 1997.",
    "This receipt acknowledges a voluntary tax-deductible gift. No goods or services were provided in return for this donation.",
    "This receipt may be used for claiming tax deductions in Australia.",
  ],
  lines: [{ dateLabel: "01-07-2025", amountLabel: "$50.00", method: "Cash" }],
  totalLabel: "$50.00",
  coveredPeriod: "This receipt covers tax-deductible gifts received between 1 July 2025 and 30 June 2026.",
}

beforeEach(() => {
  mockLetterhead.mockReset()
})

describe("renderMembershipPdf letterhead fallback", () => {
  test("renders with a DB letterhead image", async () => {
    mockLetterhead.mockResolvedValue({ bytes: Buffer.from(SMALL_PNG_B64, "base64"), aspect: 5.8333 })
    const pdf = await renderMembershipPdf(membershipModel)
    expect(mockLetterhead).toHaveBeenCalled()
    expect(pdf.length).toBeGreaterThan(0)
  })

  test("renders a text header when no letterhead is set", async () => {
    mockLetterhead.mockResolvedValue(null)
    const pdf = await renderMembershipPdf(membershipModel)
    expect(mockLetterhead).toHaveBeenCalled()
    expect(pdf.length).toBeGreaterThan(0)
  })
})

describe("renderDgrReceiptPdf letterhead fallback", () => {
  test("renders with a DB letterhead image", async () => {
    mockLetterhead.mockResolvedValue({ bytes: Buffer.from(SMALL_PNG_B64, "base64"), aspect: 5.8333 })
    const pdf = await renderDgrReceiptPdf(dgrModel)
    expect(mockLetterhead).toHaveBeenCalled()
    expect(pdf.length).toBeGreaterThan(0)
  })

  test("renders a text header when no letterhead is set", async () => {
    mockLetterhead.mockResolvedValue(null)
    const pdf = await renderDgrReceiptPdf(dgrModel)
    expect(mockLetterhead).toHaveBeenCalled()
    expect(pdf.length).toBeGreaterThan(0)
  })
})
