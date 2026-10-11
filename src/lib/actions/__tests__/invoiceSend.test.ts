import { sendInvoice, markInvoiceSent, resendInvoice } from "@/lib/actions/invoiceSend"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { sendEmail } from "@/lib/email"
import { loadInvoicePdf } from "@/lib/invoicePdfModel"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }))
jest.mock("@/lib/invoicePdfModel", () => ({ loadInvoicePdf: jest.fn() }))
jest.mock("@/lib/invoiceSettings", () => ({ getInvoiceSettings: jest.fn(async () => ({ gstRegistered: true, paymentDetails: "BSB 000-000" })) }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn(async () => ({ name: "Example Church", address: "", abn: "", email: "" })) }))
jest.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findUnique: jest.fn(), aggregate: jest.fn(), updateMany: jest.fn() }, $transaction: jest.fn() },
}))

const mockAuth = auth as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })
const draft = { id: 11, status: "DRAFT", invoiceNo: null, recipientEmail: "enc:scouts@example.com" }
beforeEach(() => {
  jest.clearAllMocks(); as("ADMIN")
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue(draft)
  ;(prisma.invoice.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: 6 } })
  ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(sendEmail as jest.Mock).mockResolvedValue(undefined)
  ;(loadInvoicePdf as jest.Mock).mockResolvedValue({ pdf: Buffer.from("%PDF"), filename: "INV-0007.pdf", recipientEmail: "scouts@example.com", invoiceNo: "INV-0007", recipientName: "Example Scouts", total: "$330.00", dueDate: "25 October 2026" })
})

describe("sendInvoice", () => {
  it.each(["OFFICE_ADMIN", "AUDITOR", "VIEWER"])("rejects %s", async (r) => { as(r); expect(await sendInvoice(11)).toEqual({ error: "Unauthorized" }) })
  it("allocates the next number, freezes GST, flips to SENT, emails the PDF", async () => {
    expect(await sendInvoice(11)).toEqual({ success: "Invoice INV-0007 emailed" })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "DRAFT", invoiceNo: null }, data: { seq: 7, invoiceNo: "INV-0007", taxInvoice: true } })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "DRAFT" }, data: expect.objectContaining({ status: "SENT", sentById: 1 }) })
    expect(sendEmail).toHaveBeenCalledWith("scouts@example.com", "Invoice INV-0007 from Example Church", expect.any(String), expect.any(String),
      [{ filename: "INV-0007.pdf", content: expect.any(Buffer), contentType: "application/pdf" }])
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_SENT", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
  it("requires an email", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...draft, recipientEmail: null })
    expect(await sendInvoice(11)).toEqual({ error: "Add a recipient email first, or use Mark as sent" })
  })
  it("rejects non-drafts", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...draft, status: "SENT" })
    expect(await sendInvoice(11)).toEqual({ error: "This invoice has changed. Reload and try again." })
  })
  it("reverts to DRAFT (keeping the number) when email fails", async () => {
    ;(sendEmail as jest.Mock).mockRejectedValueOnce(new Error("smtp"))
    expect(await sendInvoice(11)).toEqual({ error: "Email failed — the invoice is still a draft (number kept). Try again or mark it as sent." })
    expect(prisma.invoice.updateMany).toHaveBeenLastCalledWith({ where: { id: 11, status: "SENT", sentAt: expect.any(Date) }, data: { status: "DRAFT", sentAt: null, sentById: null } })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_SEND_FAILED", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
  it("keeps an existing number", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...draft, invoiceNo: "INV-0003" })
    await sendInvoice(11)
    expect(prisma.invoice.aggregate).not.toHaveBeenCalled()
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
})

describe("resendInvoice", () => {
  it("only for SENT", async () => {
    expect(await resendInvoice(11)).toEqual({ error: "Only sent invoices can be re-sent" })
  })
  it("re-emails a SENT invoice", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...draft, status: "SENT", invoiceNo: "INV-0007" })
    expect(await resendInvoice(11)).toEqual({ success: "Invoice INV-0007 re-sent" })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_RESENT", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
})
