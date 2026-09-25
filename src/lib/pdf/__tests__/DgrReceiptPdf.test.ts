/** @jest-environment node */
import PDFDocument from "pdfkit"
import { renderDgrReceiptPdf } from "@/lib/pdf/DgrReceiptPdf"
import type { DgrPdfModel } from "@/lib/dgr"

jest.mock("@/lib/branding", () => ({ getLetterheadAsset: jest.fn().mockResolvedValue(null) }))

const model: DgrPdfModel = {
  churchName: "Grace Church", churchAbn: "12 345", churchAddress: "1 St", churchEmail: "g@x.org",
  receiptNo: "RCPT-2025-001", issueDate: "5 July 2025", fyLabel: "2024–25", donorName: "Jane",
  documentTitle: "ANNUAL TAX RECEIPT",
  totalDonationsLabel: "TOTAL DONATIONS",
  legalLines: ["Grace Church is a registered charity.", "No goods or services were provided."],
  lines: [{ dateLabel: "1 August 2024", amountLabel: "$100.00", method: "Bank" }],
  totalLabel: "$100.00",
  coveredPeriod: "This receipt covers gifts between 1 July 2024 and 30 June 2025.",
}

it("renders a non-empty PDF buffer with custom legal/title strings", async () => {
  const buf = await renderDgrReceiptPdf(model)
  expect(buf).toBeInstanceOf(Buffer)
  expect(buf.length).toBeGreaterThan(1000)
})

describe("layout", () => {
  let calls: { text: string; x: number; y: number }[]
  let spy: jest.SpyInstance
  beforeEach(() => {
    calls = []
    const orig = PDFDocument.prototype.text
    spy = jest.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      calls.push({ text: String(args[0]), x: args[1] as number, y: args[2] as number })
      return (orig as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args)
    })
  })
  afterEach(() => spy.mockRestore())

  it("redraws table headings on every continuation page", async () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ dateLabel: `d${i}`, amountLabel: "$1.00", method: "Bank" }))
    await renderDgrReceiptPdf({ ...model, lines })
    // Walk the row cells; a Y reset between consecutive rows is a page break,
    // and a DATE heading must be drawn between the two rows.
    const rowIdx = calls.map((c, i) => (/^d\d+$/.test(c.text) ? i : -1)).filter((i) => i >= 0)
    let breaks = 0
    for (let k = 1; k < rowIdx.length; k++) {
      if (calls[rowIdx[k]].y < calls[rowIdx[k - 1]].y) {
        breaks++
        const between = calls.slice(rowIdx[k - 1] + 1, rowIdx[k])
        expect(between.some((c) => c.text === "DATE")).toBe(true)
      }
    }
    expect(breaks).toBeGreaterThanOrEqual(1)
  })

  it("pushes the hero total below a wrapped long donor name", async () => {
    const donorName = "Very Long Donor Name ".repeat(12).trim()
    await renderDgrReceiptPdf({ ...model, donorName })
    const name = calls.find((c) => c.text === donorName)!
    const total = calls.find((c) => c.text === model.totalLabel)!
    const doc = new PDFDocument({ size: "A4", margin: 48 })
    const nameH = doc.font("Helvetica-Bold").fontSize(15).heightOfString(donorName, { width: doc.page.width - 96 })
    expect(total.y).toBeGreaterThanOrEqual(name.y + nameH)
  })
})
