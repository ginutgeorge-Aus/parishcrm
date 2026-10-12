/** @jest-environment node */
import { renderInvoicePdf } from "@/lib/pdf/InvoicePdf"

jest.mock("@/lib/branding", () => ({ getLetterheadAsset: jest.fn(async () => null) }))

const model = {
  title: "Tax Invoice" as const, draft: false, invoiceNo: "INV-0001", issueDate: "11 October 2026", dueDate: "25 October 2026",
  church: { name: "Example Church", address: "1 Example St", abn: "51824753556", email: "church@example.com" },
  recipient: { name: "Example Scouts", email: "scouts@example.com", address: "1 Example St" }, showGst: true,
  lines: [{ description: "Hall hire", qty: 2, unitPrice: "$150.00", gst: "$30.00", amount: "$300.00" }],
  subtotal: "$300.00", gstTotal: "$30.00", total: "$330.00", notes: "", paymentDetails: "BSB 000-000",
}

describe("renderInvoicePdf", () => {
  it.each([
    ["tax", model],
    ["plain", { ...model, title: "Invoice" as const, showGst: false }],
    ["draft", { ...model, draft: true, invoiceNo: null }],
    ["many lines", { ...model, lines: Array.from({ length: 50 }, () => model.lines[0]) }],
    ["long wrapping descriptions", { ...model, lines: Array.from({ length: 12 }, () => ({ ...model.lines[0], description: "Hall hire including kitchen, chairs and tables. ".repeat(10) })) }],
  ])("renders a %s invoice", async (_n, m) => {
    const pdf = await renderInvoicePdf(m)
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(pdf.length).toBeGreaterThan(1000)
  })
})

describe("renderInvoicePdf footer space", () => {
  it("keeps long wrapping notes and payment details out of the footer band", async () => {
    const PDFDocument = require("pdfkit") as { prototype: Record<string, (...a: unknown[]) => unknown> }
    const orig = PDFDocument.prototype._fragment
    const drawn: { text: string; y: number }[] = []
    const spy = jest.spyOn(PDFDocument.prototype, "_fragment").mockImplementation(function (this: unknown, ...a: unknown[]) {
      drawn.push({ text: String(a[0]), y: Number(a[2]) })
      return orig.apply(this, a)
    })
    try {
      const long = "Please quote the invoice number when paying and allow three business days. ".repeat(40)
      await renderInvoicePdf({ ...model, lines: Array.from({ length: 20 }, () => model.lines[0]), notes: long, paymentDetails: long })
    } finally { spy.mockRestore() }
    // A4 height 841.89; body must end above MARGIN (48) + FOOTER_H (50); the footer itself sits at height - 60.
    const footerY = 841.89 - 48 - 12
    const intruders = drawn.filter((d) => Math.abs(d.y - footerY) > 0.5 && d.y + 10 > 841.89 - 98)
    expect(intruders).toEqual([])
  })
})
