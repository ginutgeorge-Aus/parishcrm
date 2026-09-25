/** @jest-environment node */
// No branding letterhead row in these tests — exercises the text-header
// fallback path (dedicated letterhead-fallback.test.ts covers the image path).
jest.mock("@/lib/branding", () => ({ getLetterheadAsset: jest.fn().mockResolvedValue(null) }))

import { renderDgrReceiptPdf } from "@/lib/pdf/DgrReceiptPdf"
import type { DgrPdfModel } from "@/lib/dgr"
import { extractText } from "unpdf"

// The first legal line intentionally mirrors the church's own DGR wording
// (churchName pre-substituted, as buildDgrPdfModel does upstream) so the
// page-break assertions below — written against this exact fund-specific
// sentence — keep testing the same wrap/pagination behaviour.
const legalLine1 = (churchName: string): string =>
  `${churchName} is endorsed as a Deductible Gift Recipient (DGR) under Item 1 of the table in section 30-15 of the Income Tax Assessment Act 1997, specifically for its School Building Fund.`
const LEGAL_LINES_2_3 = [
  "This receipt acknowledges a voluntary tax-deductible gift made to the School Building Fund. No goods or services were provided in return for this donation.",
  "This receipt may be used for claiming tax deductions in Australia.",
]

const model: DgrPdfModel = {
  churchName: "Example Community Church", churchAbn: "51824753556", churchAddress: "", churchEmail: "c@x.com",
  receiptNo: "DGR-2025-001", issueDate: "08-07-2025", fyLabel: "2024–25", donorName: "Alex Admin",
  documentTitle: "ANNUAL TAX-DEDUCTIBLE RECEIPT",
  totalDonationsLabel: "TOTAL TAX-DEDUCTIBLE DONATIONS",
  legalLines: [legalLine1("Example Community Church"), ...LEGAL_LINES_2_3],
  lines: [{ dateLabel: "24-07-2024", amountLabel: "$100.00", method: "Bank Transfer" }],
  totalLabel: "$100.00", coveredPeriod: "This receipt covers tax-deductible gifts received between 1 July 2024 and 30 June 2025.",
}

it("renders a non-empty PDF buffer", async () => {
  const buf = await renderDgrReceiptPdf(model)
  expect(Buffer.isBuffer(buf)).toBe(true)
  expect(buf.length).toBeGreaterThan(1000)
  expect(buf.subarray(0, 5).toString()).toBe("%PDF-")
})

it("keeps the total row with the first legal line near a page boundary", async () => {
  const fullModel: DgrPdfModel = {
    ...model,
    lines: Array.from({ length: 19 }, (_, i) => ({
      dateLabel: `${String(i + 1).padStart(2, "0")}-07-2024`,
      amountLabel: "$100.00",
      method: "Bank Transfer",
    })),
    totalLabel: "$1,900.00",
  }

  const buf = await renderDgrReceiptPdf(fullModel)
  const { text: pages } = await extractText(new Uint8Array(buf), { mergePages: false })
  const totalPage = pages.findIndex((page) => page.includes("Total"))
  const firstLegalPage = pages.findIndex((page) => page.includes("is endorsed as a Deductible Gift"))

  expect(totalPage).toBeGreaterThanOrEqual(0)
  expect(firstLegalPage).toBe(totalPage)
})

it("keeps a wrapped first legal paragraph with the total row", async () => {
  const longChurchName = "The Very Long Named Community Church of Springfield and the Hunter Region ".repeat(3).trim()
  const fullModel: DgrPdfModel = {
    ...model,
    churchName: longChurchName,
    legalLines: [legalLine1(longChurchName), ...LEGAL_LINES_2_3],
    lines: Array.from({ length: 18 }, (_, i) => ({
      dateLabel: `${String(i + 1).padStart(2, "0")}-07-2024`,
      amountLabel: "$100.00",
      method: "Bank Transfer",
    })),
    totalLabel: "$1,800.00",
  }

  const buf = await renderDgrReceiptPdf(fullModel)
  const { text: pages } = await extractText(new Uint8Array(buf), { mergePages: false })
  const normalizedPages = pages.map((page) => page.replace(/\s+/g, " "))
  const totalPage = normalizedPages.findIndex((page) => page.includes("Total"))
  const completeFirstLegalPage = normalizedPages.findIndex(
    (page) =>
      page.includes("is endorsed as a Deductible Gift Recipient") &&
      page.includes("specifically for its School Building Fund."),
  )

  expect(totalPage).toBe(1)
  expect(completeFirstLegalPage).toBe(totalPage)
})

it("does not let the legal-loop guard override the measured preflight", async () => {
  const fullModel: DgrPdfModel = {
    ...model,
    churchName: "X",
    legalLines: [legalLine1("X"), ...LEGAL_LINES_2_3],
    lines: Array.from({ length: 18 }, (_, i) => ({
      dateLabel: `${String(i + 1).padStart(2, "0")}-07-2024`,
      amountLabel: "$100.00",
      method:
        i < 2
          ? "Bank transfer with a moderately long reference that wraps onto another line"
          : "Bank Transfer",
    })),
    totalLabel: "$1,800.00",
  }

  const buf = await renderDgrReceiptPdf(fullModel)
  const { text: pages } = await extractText(new Uint8Array(buf), { mergePages: false })
  const totalPage = pages.findIndex((page) => page.includes("Total"))
  const firstLegalPage = pages.findIndex((page) => page.includes("is endorsed as a Deductible Gift"))

  expect(totalPage).toBeGreaterThanOrEqual(0)
  expect(firstLegalPage).toBe(totalPage)
})

it("renders documentTitle and totalDonationsLabel from the model", async () => {
  const buf = await renderDgrReceiptPdf(model)
  const { text: pages } = await extractText(new Uint8Array(buf), { mergePages: true })

  expect(pages).toContain(model.documentTitle)
  expect(pages).toContain(model.totalDonationsLabel)
})

it("paginates a legal paragraph taller than a page, with header + footer on every page", async () => {
  const longLegal = Array.from({ length: 400 }, (_, i) => `clause${i}`).join(" ") + " FINAL-LEGAL-WORD."
  const longPeriod = "This receipt covers gifts received in the period stated. ".repeat(6) + "FINAL-PERIOD-WORD."
  const buf = await renderDgrReceiptPdf({
    ...model,
    legalLines: [longLegal, longLegal, ...LEGAL_LINES_2_3],
    coveredPeriod: longPeriod,
  })
  const { text: pages } = await extractText(new Uint8Array(buf), { mergePages: false })
  const all = pages.join(" ")

  expect(pages.length).toBeGreaterThan(1)
  // A pdfkit auto-overflow page would lack the letterhead/title and footer.
  for (const page of pages) {
    expect(page).toContain(model.documentTitle)
    expect(page).toContain(`ABN ${model.churchAbn}`)
  }
  expect(all.split("FINAL-LEGAL-WORD").length - 1).toBe(2)
  expect(all).toContain("clause399")
  expect(all).toContain("FINAL-PERIOD-WORD")
})

it("splits a single token taller than a page instead of overflowing", async () => {
  const token = "X".repeat(12000) + "END-TOKEN"
  const buf = await renderDgrReceiptPdf({ ...model, legalLines: [token] })
  const { text: pages } = await extractText(new Uint8Array(buf), { mergePages: false })

  expect(pages.length).toBeGreaterThan(1)
  for (const page of pages) {
    expect(page).toContain(model.documentTitle)
    expect(page).toContain(`ABN ${model.churchAbn}`)
  }
  expect(pages.join("")).toContain("END-TOKEN")
})
