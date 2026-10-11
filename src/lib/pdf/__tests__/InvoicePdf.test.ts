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
  ])("renders a %s invoice", async (_n, m) => {
    const pdf = await renderInvoicePdf(m)
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(pdf.length).toBeGreaterThan(1000)
  })
})
