jest.mock("@/lib/featureFlags")
import { voidInvoice } from "@/lib/actions/invoiceVoid"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { invoice: { findUnique: jest.fn(), updateMany: jest.fn() } } }))

const mockAuth = auth as jest.Mock
beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ status: "SENT", invoiceNo: "INV-0007" })
  ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
})

describe("voidInvoice", () => {
  it.each(["OFFICE_ADMIN", "AUDITOR"])("rejects %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } })
    expect(await voidInvoice(11, "Duplicate")).toEqual({ error: "Unauthorized" })
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
  })
  it("requires a reason", async () => expect(await voidInvoice(11, "  ")).toEqual({ error: "Give a reason for voiding" }))
  it("caps the reason length", async () => expect(await voidInvoice(11, "x".repeat(501))).toEqual({ error: "Reason must be 500 characters or fewer" }))
  it("rejects an invalid id", async () => expect(await voidInvoice(-1, "Duplicate")).toEqual({ error: "Invoice not found" }))
  it("voids a SENT invoice", async () => {
    expect(await voidInvoice(11, " Duplicate ")).toEqual({ success: "INV-0007 voided" })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "SENT" }, data: { status: "VOID", voidedAt: expect.any(Date), voidReason: "Duplicate" } })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_VOIDED", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
  it("refuses PAID", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ status: "PAID", invoiceNo: "INV-0007" })
    expect(await voidInvoice(11, "x")).toEqual({ error: "Unmark the payment before voiding" })
  })
  it("refuses DRAFT", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ status: "DRAFT", invoiceNo: null })
    expect(await voidInvoice(11, "x")).toEqual({ error: "Only sent invoices can be voided — delete the draft instead" })
  })
  it("returns CHANGED on a race", async () => {
    ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await voidInvoice(11, "x")).toEqual({ error: "This invoice has changed. Reload and try again." })
    expect(logAudit).not.toHaveBeenCalled()
  })
})
