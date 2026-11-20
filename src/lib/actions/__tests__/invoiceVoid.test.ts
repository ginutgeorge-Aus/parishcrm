jest.mock("@/lib/featureFlags")
import { voidInvoice } from "@/lib/actions/invoiceVoid"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAuditTx } from "@/lib/audit"
import { AUDIT_FAILED_ERROR } from "@/lib/auditGuard"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  // Distinct tx client: the mutation exists only on it, so a write via the root client throws and fails the test.
  const tx = { invoice: { updateMany: jest.fn() } }
  const prisma: Record<string, unknown> = { invoice: { findUnique: jest.fn() }, __tx: tx }
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(tx))
  return { prisma }
})

const tx = (prisma as unknown as { __tx: { invoice: { updateMany: jest.Mock } } }).__tx
const mockAuth = auth as jest.Mock
beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ status: "SENT", invoiceNo: "INV-0007" })
  ;tx.invoice.updateMany.mockResolvedValue({ count: 1 })
})

describe("voidInvoice", () => {
  it.each(["OFFICE_ADMIN", "AUDITOR"])("rejects %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } })
    expect(await voidInvoice(11, "Duplicate")).toEqual({ error: "Unauthorized" })
    expect(tx.invoice.updateMany).not.toHaveBeenCalled()
  })
  it("requires a reason", async () => expect(await voidInvoice(11, "  ")).toEqual({ error: "Give a reason for voiding" }))
  it("caps the reason length", async () => expect(await voidInvoice(11, "x".repeat(501))).toEqual({ error: "Reason must be 500 characters or fewer" }))
  it("rejects an invalid id", async () => expect(await voidInvoice(-1, "Duplicate")).toEqual({ error: "Invoice not found" }))
  it("voids a SENT invoice", async () => {
    expect(await voidInvoice(11, " Duplicate ")).toEqual({ success: "INV-0007 voided" })
    expect(tx.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "SENT" }, data: { status: "VOID", voidedAt: expect.any(Date), voidReason: "Duplicate" } })
    expect(logAuditTx).toHaveBeenCalledWith(tx, 1, "INVOICE_VOIDED", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
  it("returns AUDIT_FAILED_ERROR when the in-transaction audit write fails", async () => {
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
    expect(await voidInvoice(11, "x")).toEqual({ error: AUDIT_FAILED_ERROR })
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
    ;tx.invoice.updateMany.mockResolvedValue({ count: 0 })
    expect(await voidInvoice(11, "x")).toEqual({ error: "This invoice has changed. Reload and try again." })
    expect(logAuditTx).not.toHaveBeenCalled()
  })
})
