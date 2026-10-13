/** @jest-environment node */
import { buildInvoicePdfModel, loadInvoicePdf,  churchReadyError, buildIssuerSnapshot } from "@/lib/invoicePdfModel"
import { prisma } from "@/lib/prisma"
import { getChurchSettingsFresh, getChurchSettingsStrict } from "@/lib/churchSettings"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import { logger } from "@/lib/logger"
import { renderInvoicePdf } from "@/lib/pdf/InvoicePdf"

jest.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findUnique: jest.fn(), updateMany: jest.fn((a: unknown) => a) }, $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)) },
  Prisma: { DbNull: "DbNull" },
}))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v),
  encryptBytes: jest.fn((b: Buffer) => Buffer.from(`enc:${b.toString("base64")}`)),
  decryptBytes: jest.fn((b: Buffer) => {
    const t = b.toString("utf8")
    if (!t.startsWith("enc:")) throw new Error("bad blob")
    return Buffer.from(t.slice(4), "base64")
  }),
}))
jest.mock("@/lib/pdf/InvoicePdf", () => ({ renderInvoicePdf: jest.fn(async () => Buffer.from("%PDF")) }))
jest.mock("@/lib/invoiceSettings", () => ({ getInvoiceSettings: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettingsFresh: jest.fn(async () => ({ name: "Example Church", address: "", abn: "", email: "", website: "" })),
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
    expect(getChurchSettingsFresh).toHaveBeenCalled()
    expect(getChurchSettingsStrict).not.toHaveBeenCalled()
  })
  it("sent invoice renders from its frozen issuer snapshot, not live settings", async () => {
    const issuer = { name: "Old Church Name", address: "Old St", abn: "11111111111", email: "old@example.com", paymentDetails: "Old BSB" }
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...row, taxInvoice: true, issuer })
    const out = await loadInvoicePdf(11)
    expect(out).toMatchObject({ churchName: "Old Church Name", paymentDetails: "Old BSB" })
    expect(getChurchSettingsFresh).not.toHaveBeenCalled()
    expect(getChurchSettingsStrict).not.toHaveBeenCalled()
  })
  it("sent invoice with a snapshot renders even when the live settings read fails", async () => {
    const issuer = { name: "Old Church Name", address: "Old St", abn: "11111111111", email: "old@example.com", paymentDetails: "Old BSB" }
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...row, taxInvoice: true, issuer })
    ;(getInvoiceSettings as jest.Mock).mockRejectedValue(new Error("db down"))
    await expect(loadInvoicePdf(11)).resolves.toMatchObject({ paymentDetails: "Old BSB" })
    expect(getInvoiceSettings).not.toHaveBeenCalled()
  })
  it("ignores a malformed snapshot and falls back to live settings", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...row, issuer: { name: 5 } })
    expect(await loadInvoicePdf(11)).toMatchObject({ churchName: "Example Church" })
    expect(getChurchSettingsFresh).toHaveBeenCalled()
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

describe("frozen PDF", () => {
  const issuer = { name: "Old Church Name", address: "Old St", abn: "11111111111", email: "old@example.com", paymentDetails: "Old BSB" }
  const sent = {
    id: 11, invoiceNo: "INV-0001", status: "SENT", taxInvoice: true, issueDate: new Date("2026-10-11"), dueDate: new Date("2026-10-25"),
    recipientName: "Example Scouts", recipientEmail: "scouts@example.com", recipientAddress: null, issuer,
    lines: [{ description: "Hall hire", qty: 1, unitPriceCents: 10000, gst: false }],
    subtotal: { toString: () => "100.00" }, gstTotal: { toString: () => "0.00" }, total: { toString: () => "100.00" }, notes: null,
  }
  const stored = Buffer.from(`enc:${Buffer.from("%PDF-frozen").toString("base64")}`)
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma.invoice.updateMany as jest.Mock).mockImplementation((a: unknown) => a)
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (ops: unknown[]) => Promise.all(ops))
    ;(getInvoiceSettings as jest.Mock).mockResolvedValue({ gstRegistered: false, paymentDetails: "" })
  })

  it.each(["SENT", "PAID", "VOID"])("%s invoice serves the stored bytes: no render, no write, only metadata", async (status) => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...sent, status, frozenPdf: stored })
    const out = await loadInvoicePdf(11)
    expect(out?.pdf.toString()).toBe("%PDF-frozen")
    expect(out).toMatchObject({ filename: "INV-0001.pdf", churchName: "Old Church Name", paymentDetails: "Old BSB", total: "$100.00", recipientEmail: "scouts@example.com" })
    expect(renderInvoicePdf).not.toHaveBeenCalled()
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
  })
  it("draft always renders live and never stores", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...sent, status: "DRAFT", invoiceNo: null, frozenPdf: stored })
    expect((await loadInvoicePdf(11))?.pdf.toString()).toBe("%PDF")
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
  })
  it("sent invoice without a stored PDF renders live, then freezes it with a conditional write", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...sent, frozenPdf: null })
    expect((await loadInvoicePdf(11))?.pdf.toString()).toBe("%PDF")
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 11, frozenPdf: null, status: { not: "DRAFT" } },
      data: { frozenPdf: expect.any(Buffer) },
    })
  })
  it("legacy row (no issuer, no blob): freezes blob + issuer once, then the second load serves the blob", async () => {
    const legacy = { ...sent, issuer: null, frozenPdf: null }
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValueOnce(legacy)
    const first = await loadInvoicePdf(11)
    expect(first?.pdf.toString()).toBe("%PDF")
    const notDraft = { id: 11, frozenPdf: null, status: { not: "DRAFT" } }
    expect(prisma.invoice.updateMany).toHaveBeenNthCalledWith(1, {
      where: { ...notDraft, issuer: { equals: "DbNull" } },
      data: { issuer: expect.objectContaining({ name: "Example Church" }) },
    })
    expect(prisma.invoice.updateMany).toHaveBeenNthCalledWith(2, { where: notDraft, data: { frozenPdf: expect.any(Buffer) } })
    const { issuer } = (prisma.invoice.updateMany as jest.Mock).mock.calls[0][0].data
    const { frozenPdf } = (prisma.invoice.updateMany as jest.Mock).mock.calls[1][0].data
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValueOnce({ ...legacy, issuer, frozenPdf })
    ;(renderInvoicePdf as jest.Mock).mockClear()
    expect((await loadInvoicePdf(11))?.pdf.toString()).toBe("%PDF")
    expect(renderInvoicePdf).not.toHaveBeenCalled()
  })
  it("a row that already has an issuer only gets the blob written (issuer never overwritten)", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...sent, frozenPdf: null })
    await loadInvoicePdf(11)
    expect(prisma.invoice.updateMany).toHaveBeenCalledTimes(1)
    expect((prisma.invoice.updateMany as jest.Mock).mock.calls[0][0].data).not.toHaveProperty("issuer")
  })
  it("ignores a 0-row conditional update (someone else froze first)", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...sent, frozenPdf: null })
    ;(prisma.$transaction as jest.Mock).mockResolvedValue([{ count: 0 }])
    await expect(loadInvoicePdf(11)).resolves.toMatchObject({ filename: "INV-0001.pdf" })
    expect(logger.error).not.toHaveBeenCalled()
  })
  it("logs but still serves the PDF when the freeze write fails", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...sent, frozenPdf: null })
    ;(prisma.$transaction as jest.Mock).mockRejectedValue(new Error("db down"))
    await expect(loadInvoicePdf(11)).resolves.toMatchObject({ filename: "INV-0001.pdf" })
    expect(logger.error).toHaveBeenCalledWith("invoice frozenPdf store failed", expect.objectContaining({ invoiceId: 11 }))
  })
  it("logs a non-Error freeze failure too", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...sent, frozenPdf: null })
    ;(prisma.$transaction as jest.Mock).mockRejectedValue("boom")
    await loadInvoicePdf(11)
    expect(logger.error).toHaveBeenCalledWith("invoice frozenPdf store failed", { invoiceId: 11, message: "unknown" })
  })
  it("undecryptable stored blob: logs the id, renders live, never overwrites the blob", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...sent, frozenPdf: Buffer.from("garbage") })
    expect((await loadInvoicePdf(11))?.pdf.toString()).toBe("%PDF")
    expect(logger.error).toHaveBeenCalledWith("invoice frozenPdf unreadable, rendering live", expect.objectContaining({ invoiceId: 11 }))
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
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
    expect(getChurchSettingsFresh).toHaveBeenCalled()
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
