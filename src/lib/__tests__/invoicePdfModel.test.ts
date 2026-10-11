/** @jest-environment node */
import { buildInvoicePdfModel, loadInvoicePdf, churchReadyError, buildIssuerSnapshot } from "@/lib/invoicePdfModel"
import { prisma } from "@/lib/prisma"
import { getChurchSettings, getChurchSettingsStrict } from "@/lib/churchSettings"
import { getInvoiceSettings } from "@/lib/invoiceSettings"

jest.mock("@/lib/prisma", () => ({ prisma: { invoice: { findUnique: jest.fn() } } }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v) }))
jest.mock("@/lib/pdf/InvoicePdf", () => ({ renderInvoicePdf: jest.fn(async () => Buffer.from("%PDF")) }))
jest.mock("@/lib/invoiceSettings", () => ({ getInvoiceSettings: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn(async () => ({ name: "Example Church", address: "", abn: "", email: "", website: "" })),
  getChurchSettingsStrict: jest.fn(async () => ({ name: "Example Church", address: "1 Example St", abn: "51824753556", email: "", website: "" })),
}))

const church = { name: "Example Church", address: "1 Example St", abn: "51824753556", email: "church@example.com" }
const base = {
  invoiceNo: "INV-0001", status: "SENT" as const, taxInvoice: true, issueDate: new Date("2026-10-11"), dueDate: new Date("2026-10-25"),
  recipientName: "Example Scouts", recipientEmail: "scouts@example.com", recipientAddress: "1 Example St",
  lines: [{ description: "Hall hire", qty: 2, unitPriceCents: 15000, gst: true }],
  subtotal: "300.00", gstTotal: "30.00", total: "330.00", notes: "",
}

describe("buildInvoicePdfModel", () => {
  it("tax invoice shows GST", () => {
    const m = buildInvoicePdfModel(base, church, { gstRegistered: false, paymentDetails: "BSB 000-000" })
    expect(m).toMatchObject({ title: "Tax Invoice", showGst: true, draft: false, invoiceNo: "INV-0001", paymentDetails: "BSB 000-000" })
    expect(m.lines[0]).toEqual({ description: "Hall hire", qty: 2, unitPrice: "$150.00", gst: "$30.00", amount: "$300.00" })
    expect(m.total).toBe("$330.00")
  })
  it("plain invoice hides GST", () => {
    expect(buildInvoicePdfModel({ ...base, taxInvoice: false }, church, { gstRegistered: true, paymentDetails: "" }))
      .toMatchObject({ title: "Invoice", showGst: false })
  })
  it("draft recomputes totals with the current GST setting", () => {
    const m = buildInvoicePdfModel({ ...base, status: "DRAFT", invoiceNo: null, gstTotal: "0.00", total: "300.00" }, church, { gstRegistered: true, paymentDetails: "" })
    expect(m).toMatchObject({ gstTotal: "$30.00", total: "$330.00" })
  })
  it("draft follows current settings", () => {
    expect(buildInvoicePdfModel({ ...base, status: "DRAFT", invoiceNo: null, taxInvoice: false }, church, { gstRegistered: true, paymentDetails: "" }))
      .toMatchObject({ draft: true, title: "Tax Invoice", showGst: true, invoiceNo: null })
  })
})

describe("loadInvoicePdf", () => {
  const row = {
    id: 11, invoiceNo: "INV-0001", status: "SENT", taxInvoice: false, issueDate: new Date("2026-10-11"), dueDate: new Date("2026-10-25"),
    recipientName: "Example Scouts", recipientEmail: "scouts@example.com", recipientAddress: null,
    lines: [{ description: "Hall hire", qty: 1, unitPriceCents: 10000, gst: false }],
    subtotal: { toString: () => "100.00" }, gstTotal: { toString: () => "0.00" }, total: { toString: () => "100.00" }, notes: null,
  }
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getInvoiceSettings as jest.Mock).mockResolvedValue({ gstRegistered: false, paymentDetails: "" })
  })
  it("returns null for a missing invoice", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await loadInvoicePdf(11)).toBeNull()
  })
  it("plain invoice does not require an ABN", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue(row)
    const out = await loadInvoicePdf(11)
    expect(out).toMatchObject({ filename: "INV-0001.pdf", invoiceNo: "INV-0001", recipientEmail: "scouts@example.com", total: "$100.00" })
    expect(getChurchSettings).toHaveBeenCalled()
    expect(getChurchSettingsStrict).not.toHaveBeenCalled()
  })
  it("sent invoice renders from its frozen issuer snapshot, not live settings", async () => {
    const issuer = { name: "Old Church Name", address: "Old St", abn: "11111111111", email: "old@example.com", paymentDetails: "Old BSB" }
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...row, taxInvoice: true, issuer })
    const out = await loadInvoicePdf(11)
    expect(out).toMatchObject({ churchName: "Old Church Name", paymentDetails: "Old BSB" })
    expect(getChurchSettings).not.toHaveBeenCalled()
    expect(getChurchSettingsStrict).not.toHaveBeenCalled()
  })
  it("ignores a malformed snapshot and falls back to live settings", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...row, issuer: { name: 5 } })
    expect(await loadInvoicePdf(11)).toMatchObject({ churchName: "Example Church" })
    expect(getChurchSettings).toHaveBeenCalled()
  })
  it("tax invoice uses strict church settings", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...row, taxInvoice: true })
    await loadInvoicePdf(11)
    expect(getChurchSettingsStrict).toHaveBeenCalled()
  })
  it("draft names the file by id and follows the current GST setting", async () => {
    ;(getInvoiceSettings as jest.Mock).mockResolvedValue({ gstRegistered: true, paymentDetails: "" })
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...row, status: "DRAFT", invoiceNo: null })
    expect(await loadInvoicePdf(11)).toMatchObject({ filename: "DRAFT-11.pdf" })
    expect(getChurchSettingsStrict).toHaveBeenCalled()
  })
})

describe("buildIssuerSnapshot", () => {
  beforeEach(() => jest.clearAllMocks())
  it("uses strict settings for a tax invoice and includes payment details", async () => {
    expect(await buildIssuerSnapshot(true, { gstRegistered: true, paymentDetails: "BSB 000-000" })).toEqual({
      name: "Example Church", address: "1 Example St", abn: "51824753556", email: "", paymentDetails: "BSB 000-000",
    })
    expect(getChurchSettingsStrict).toHaveBeenCalled()
  })
  it("uses lenient settings for a plain invoice", async () => {
    await buildIssuerSnapshot(false, { gstRegistered: false, paymentDetails: "" })
    expect(getChurchSettings).toHaveBeenCalled()
    expect(getChurchSettingsStrict).not.toHaveBeenCalled()
  })
})

describe("churchReadyError", () => {
  beforeEach(() => jest.clearAllMocks())
  it("is null for a plain invoice without checking", async () => {
    expect(await churchReadyError(false)).toBeNull()
    expect(getChurchSettingsStrict).not.toHaveBeenCalled()
  })
  it("returns the configuration message for a tax invoice", async () => {
    ;(getChurchSettingsStrict as jest.Mock).mockRejectedValueOnce(new Error("Church ABN not configured — set church details in Settings before issuing receipts."))
    expect(await churchReadyError(true)).toBe("Church ABN not configured — set church details in Settings before issuing tax invoices.")
  })
  it("hides other errors", async () => {
    ;(getChurchSettingsStrict as jest.Mock).mockRejectedValueOnce(new Error("connection refused"))
    expect(await churchReadyError(true)).toBe("Could not load church details. Please try again.")
  })
})
