import { sendInvoice, markInvoiceSent, resendInvoice } from "@/lib/actions/invoiceSend"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { sendEmail } from "@/lib/email"
import { buildIssuerSnapshot, churchReadyError, loadInvoicePdf } from "@/lib/invoicePdfModel"
import { getInvoiceSettings } from "@/lib/invoiceSettings"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }))
jest.mock("@/lib/invoicePdfModel", () => ({ loadInvoicePdf: jest.fn(), churchReadyError: jest.fn(), buildIssuerSnapshot: jest.fn() }))
jest.mock("@/lib/invoiceSettings", () => ({ getInvoiceSettings: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findUnique: jest.fn(), aggregate: jest.fn(), updateMany: jest.fn() }, $transaction: jest.fn() },
}))

const mockAuth = auth as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })
const lines = [{ description: "Hall hire", qty: 2, unitPriceCents: 15000, gst: true }]
const issuer = { name: "Example Church", address: "1 Example St", abn: "51824753556", email: "church@example.com", paymentDetails: "BSB 000-000" }
const v1 = new Date("2026-10-11T00:00:00Z")
const draft = { id: 11, status: "DRAFT", invoiceNo: null, recipientEmail: "enc:scouts@example.com", lines, taxInvoice: false, updatedAt: v1 }
beforeEach(() => {
  jest.clearAllMocks(); as("ADMIN")
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue(draft)
  ;(prisma.invoice.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: 6 } })
  ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(sendEmail as jest.Mock).mockResolvedValue(undefined)
  ;(churchReadyError as jest.Mock).mockResolvedValue(null)
  ;(buildIssuerSnapshot as jest.Mock).mockResolvedValue(issuer)
  ;(getInvoiceSettings as jest.Mock).mockResolvedValue({ gstRegistered: true, paymentDetails: "BSB 000-000" })
  ;(loadInvoicePdf as jest.Mock).mockResolvedValue({
    pdf: Buffer.from("%PDF"), filename: "INV-0007.pdf", recipientEmail: "scouts@example.com", invoiceNo: "INV-0007",
    recipientName: "Example Scouts", total: "$330.00", dueDate: "25 October 2026", churchName: "Example Church", paymentDetails: "BSB 000-000",
  })
})

describe("sendInvoice", () => {
  it.each(["OFFICE_ADMIN", "AUDITOR", "VIEWER"])("rejects %s", async (r) => { as(r); expect(await sendInvoice(11)).toEqual({ error: "Unauthorized" }) })
  it("rejects an invalid id without touching the DB", async () => {
    expect(await sendInvoice(1.5)).toEqual({ error: "This invoice has changed. Reload and try again." })
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled()
  })
  it("allocates the next number, freezes GST + recomputed totals, flips to SENT, emails the PDF", async () => {
    expect(await sendInvoice(11)).toEqual({ success: "Invoice INV-0007 emailed" })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 11, status: "DRAFT", invoiceNo: null, updatedAt: v1 },
      data: {
        seq: 7, invoiceNo: "INV-0007", status: "SENT", sentAt: expect.any(Date), sentById: 1,
        taxInvoice: true, issuer, subtotal: "300.00", gstTotal: "30.00", total: "330.00",
      },
    })
    // Freeze and the SENT flip are one write — no separate status update a draft edit could race.
    expect(prisma.invoice.updateMany).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith("scouts@example.com", "Invoice INV-0007 from Example Church", expect.any(String), expect.any(String),
      [{ filename: "INV-0007.pdf", content: expect.any(Buffer), contentType: "application/pdf" }])
    expect(getInvoiceSettings).toHaveBeenCalledTimes(1)
    expect(loadInvoicePdf).toHaveBeenCalledWith(11, { gstRegistered: true, paymentDetails: "BSB 000-000" })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_SENT", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
  it("strips GST from totals when the church is no longer GST registered", async () => {
    ;(getInvoiceSettings as jest.Mock).mockResolvedValue({ gstRegistered: false, paymentDetails: "" })
    await sendInvoice(11)
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ taxInvoice: false, gstTotal: "0.00", total: "300.00" }),
    }))
  })
  it("refuses before numbering when church details are missing for a tax invoice", async () => {
    ;(churchReadyError as jest.Mock).mockResolvedValue("Church ABN not configured — set church details in Settings before issuing tax invoices.")
    expect(await sendInvoice(11)).toEqual({ error: "Church ABN not configured — set church details in Settings before issuing tax invoices." })
    expect(churchReadyError).toHaveBeenCalledWith(true)
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
  })
  it("fails cleanly when church details can't be loaded for the snapshot", async () => {
    ;(buildIssuerSnapshot as jest.Mock).mockRejectedValue(new Error("db down"))
    expect(await sendInvoice(11)).toEqual({ error: "Could not load church details. Please try again." })
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
  })
  it("refuses when the draft was edited after its lines were read (version check)", async () => {
    ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await sendInvoice(11)).toEqual({ error: "This invoice has changed. Reload and try again." })
    expect(sendEmail).not.toHaveBeenCalled()
  })
  it("requires an email", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...draft, recipientEmail: null })
    expect(await sendInvoice(11)).toEqual({ error: "Add a recipient email first, or use Mark as sent" })
  })
  it("rejects non-drafts", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...draft, status: "SENT" })
    expect(await sendInvoice(11)).toEqual({ error: "This invoice has changed. Reload and try again." })
  })
  it("stays SENT (never reopens the draft) when email fails", async () => {
    ;(sendEmail as jest.Mock).mockRejectedValueOnce(new Error("smtp"))
    expect(await sendInvoice(11)).toEqual({ error: "INV-0007 is marked as sent, but the email failed. Use Re-send to try again, or deliver it yourself." })
    expect(prisma.invoice.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT" }) }))
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_SEND_FAILED", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
  it("keeps an existing number but still refreezes totals", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...draft, invoiceNo: "INV-0003" })
    ;(loadInvoicePdf as jest.Mock).mockResolvedValue({
      pdf: Buffer.from("%PDF"), filename: "INV-0003.pdf", recipientEmail: "scouts@example.com", invoiceNo: "INV-0003",
      recipientName: "Example Scouts", total: "$330.00", dueDate: "25 October 2026", churchName: "Example Church", paymentDetails: "BSB 000-000",
    })
    expect(await sendInvoice(11)).toEqual({ success: "Invoice INV-0003 emailed" })
    expect(prisma.invoice.aggregate).not.toHaveBeenCalled()
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "DRAFT", updatedAt: v1 }, data: expect.objectContaining({ total: "330.00", taxInvoice: true, status: "SENT" }) })
  })
  it("retries once on a number collision", async () => {
    const p2002 = Object.assign(new Error("unique"), { code: "P2002" })
    ;(prisma.$transaction as jest.Mock).mockRejectedValueOnce(p2002).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
    expect(await sendInvoice(11)).toEqual({ success: "Invoice INV-0007 emailed" })
  })
})

describe("markInvoiceSent", () => {
  it("allocates and flips without emailing", async () => {
    expect(await markInvoiceSent(11)).toEqual({ success: "Invoice INV-0007 marked as sent" })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_MARKED_SENT", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
  it("also refuses a tax invoice when church details are missing", async () => {
    ;(churchReadyError as jest.Mock).mockResolvedValue("Church ABN not configured")
    expect(await markInvoiceSent(11)).toEqual({ error: "Church ABN not configured" })
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
  })
})

describe("resendInvoice", () => {
  it("only for SENT", async () => {
    expect(await resendInvoice(11)).toEqual({ error: "Only sent invoices can be re-sent" })
  })
  it("re-emails a SENT invoice", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...draft, status: "SENT", invoiceNo: "INV-0007", taxInvoice: true })
    expect(await resendInvoice(11)).toEqual({ success: "Invoice INV-0007 re-sent" })
    expect(loadInvoicePdf).toHaveBeenCalledWith(11, undefined)
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_RESENT", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
})
