import { markInvoicePaid, unmarkInvoicePaid, listPaymentCandidates } from "@/lib/actions/invoicePayment"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { assertUnlocked } from "@/lib/accountingLock"
import { sendSingleReceipt } from "@/lib/actions/receipt"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn(async () => null) }))
jest.mock("@/lib/actions/receipt", () => ({ sendSingleReceipt: jest.fn(async () => ({ success: "sent" })) }))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`), safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findUnique: jest.fn(), updateMany: jest.fn() },
    transaction: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    paymentAccount: { findUnique: jest.fn() },
    account: { findUnique: jest.fn() },
    fund: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}))

const mockAuth = auth as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })
const dec = (s: string) => ({ toString: () => s })
const inv = { id: 11, status: "SENT", invoiceNo: "INV-0007", recipientName: "Example Scouts", recipientEmail: "enc:scouts@example.com",
  personId: null, total: dec("330.00"), issueDate: new Date("2026-10-11"), accountId: 4, fundId: null }
const income = { id: 50, type: "INCOME", invoiceId: null, amount: dec("330.00"), date: new Date("2026-10-20") }
beforeEach(() => {
  jest.clearAllMocks(); as("ADMIN")
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue(inv)
  ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue(income)
  ;(prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 51 })
  ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue({ id: 2, kind: "BANK", isActive: true })
  ;(prisma.account.findUnique as jest.Mock).mockResolvedValue({ id: 4, type: "INCOME", isActive: true })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 3, isActive: true })
})

describe("markInvoicePaid — link", () => {
  const link = { mode: "link" as const, transactionId: 50, sendReceipt: false }
  it.each(["OFFICE_ADMIN", "AUDITOR", "VIEWER"])("rejects %s", async (r) => {
    as(r)
    expect(await markInvoicePaid(11, link)).toEqual({ error: "Unauthorized" })
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
  })
  it("links and flips to PAID", async () => {
    expect(await markInvoicePaid(11, link)).toEqual({ success: "INV-0007 marked paid" })
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({ where: { id: 50, invoiceId: null }, data: { invoiceId: 11 } })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "SENT" }, data: { status: "PAID", paidAt: new Date("2026-10-20") } })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_PAID", "Invoice", 11, { invoiceNo: "INV-0007", transactionId: 50, mode: "link" })
    expect(sendSingleReceipt).not.toHaveBeenCalled()
  })
  it("rejects an invalid id", async () => {
    expect(await markInvoicePaid(11, { ...link, transactionId: -1 })).toEqual({ error: "Invalid transaction" })
    expect(await markInvoicePaid(0, link)).toEqual({ error: "Invoice not found" })
  })
  it("rejects amount mismatch", async () => {
    ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ ...income, amount: dec("300.00") })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "The transaction amount must equal the invoice total ($330.00)" })
  })
  it("rejects an expense or already-linked transaction", async () => {
    ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ ...income, type: "EXPENSE" })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "Pick an income transaction that is not linked to another invoice" })
    ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ ...income, invoiceId: 9 })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "Pick an income transaction that is not linked to another invoice" })
  })
  it("rejects a payment dated before the invoice was issued", async () => {
    ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ ...income, date: new Date("2026-10-01") })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "The payment can't be dated before the invoice was issued" })
  })
  it("rejects a locked period", async () => {
    ;(assertUnlocked as jest.Mock).mockResolvedValueOnce("Period locked")
    expect(await markInvoicePaid(11, link)).toEqual({ error: "Period locked" })
  })
  it("rejects when not SENT", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...inv, status: "DRAFT" })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "Only sent invoices can be marked paid" })
  })
  it("fails cleanly if the invoice changed mid-flight", async () => {
    ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "This invoice has changed. Reload and try again." })
    expect(logAudit).not.toHaveBeenCalled()
  })
  it("rolls back if the transaction was linked elsewhere mid-flight", async () => {
    ;(prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "This invoice has changed. Reload and try again." })
  })
})

describe("markInvoicePaid — create", () => {
  const create = { mode: "create" as const, date: "2026-10-20", paymentAccountId: 2, sendReceipt: true }
  it("creates an income transaction, links it, sends receipt", async () => {
    expect(await markInvoicePaid(11, create)).toEqual({ success: "INV-0007 marked paid" })
    expect(prisma.transaction.create).toHaveBeenCalledWith({ data: {
      date: new Date("2026-10-20"), type: "INCOME", amount: "330.00", accountId: 4, paymentAccountId: 2, fundId: null,
      personId: null, reference: "INV-0007", invoiceId: 11, description: "enc:Invoice INV-0007 — Example Scouts",
    } })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_PAID", "Invoice", 11, { invoiceNo: "INV-0007", transactionId: 51, mode: "create" })
    expect(sendSingleReceipt).toHaveBeenCalledWith(51, "scouts@example.com")
  })
  it.each([
    [{ id: 2, kind: "CASH", isActive: true }],
    [{ id: 2, kind: "BANK", isActive: false }],
    [null],
  ])("rejects payment account %o", async (pa) => {
    ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue(pa)
    expect(await markInvoicePaid(11, create)).toEqual({ error: "Choose an active bank account" })
  })
  it("rejects an invalid payment account id", async () => {
    expect(await markInvoicePaid(11, { ...create, paymentAccountId: 1.5 })).toEqual({ error: "Choose an active bank account" })
  })
  it("rejects an invalid date", async () => {
    expect(await markInvoicePaid(11, { ...create, date: "2026-02-30" })).toEqual({ error: "Invalid payment date" })
  })
  it("rejects a date before issue", async () => {
    expect(await markInvoicePaid(11, { ...create, date: "2026-10-10" })).toEqual({ error: "The payment can't be dated before the invoice was issued" })
  })
  it("rejects an inactive income account or fund", async () => {
    ;(prisma.account.findUnique as jest.Mock).mockResolvedValueOnce({ id: 4, type: "INCOME", isActive: false })
    expect(await markInvoicePaid(11, create)).toEqual({ error: "The invoice's income account is inactive — reactivate it first" })
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...inv, fundId: 3 })
    ;(prisma.fund.findUnique as jest.Mock).mockResolvedValueOnce({ id: 3, isActive: false })
    expect(await markInvoicePaid(11, create)).toEqual({ error: "The invoice's fund is inactive — reactivate it first" })
  })
  it("returns CHANGED without creating when the invoice is no longer SENT", async () => {
    ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await markInvoicePaid(11, create)).toEqual({ error: "This invoice has changed. Reload and try again." })
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })
  it("warns but keeps PAID when the receipt fails", async () => {
    ;(sendSingleReceipt as jest.Mock).mockResolvedValueOnce({ error: "no consent" })
    expect(await markInvoicePaid(11, create)).toEqual({ success: "INV-0007 marked paid", warning: "Receipt not sent: no consent" })
  })
  it("warns when a receipt is requested but there is no email", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...inv, recipientEmail: null })
    expect(await markInvoicePaid(11, create)).toEqual({ success: "INV-0007 marked paid", warning: "Receipt not sent: no recipient email" })
    expect(sendSingleReceipt).not.toHaveBeenCalled()
  })
})

describe("unmarkInvoicePaid", () => {
  beforeEach(() => (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...inv, status: "PAID", paidAt: new Date("2026-10-20") }))
  it("rejects AUDITOR", async () => {
    as("AUDITOR")
    expect(await unmarkInvoicePaid(11)).toEqual({ error: "Unauthorized" })
  })
  it("clears the link and returns to SENT", async () => {
    expect(await unmarkInvoicePaid(11)).toEqual({ success: "Payment unlinked — INV-0007 is unpaid again" })
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({ where: { invoiceId: 11 }, data: { invoiceId: null } })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "PAID" }, data: { status: "SENT", paidAt: null } })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_UNPAID", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
  it("rejects when not PAID", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue(inv)
    expect(await unmarkInvoicePaid(11)).toEqual({ error: "Only paid invoices can be unmarked" })
  })
  it("rejects a locked period", async () => {
    ;(assertUnlocked as jest.Mock).mockResolvedValueOnce("Period locked")
    expect(await unmarkInvoicePaid(11)).toEqual({ error: "Period locked" })
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
  })
  it("returns CHANGED on a race", async () => {
    ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await unmarkInvoicePaid(11)).toEqual({ error: "This invoice has changed. Reload and try again." })
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled()
  })
})

describe("listPaymentCandidates", () => {
  it("rejects OFFICE_ADMIN", async () => {
    as("OFFICE_ADMIN")
    expect(await listPaymentCandidates(11)).toEqual({ error: "Unauthorized" })
  })
  it("filters unlinked income with equal amount on/after issue date", async () => {
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ id: 50, date: new Date("2026-10-20"), amount: dec("330.00"), reference: "INV-0007", paymentAccountRel: { name: "Main" } }])
    expect(await listPaymentCandidates(11)).toEqual([{ id: 50, date: "2026-10-20", amount: "330.00", reference: "INV-0007", paymentAccountName: "Main" }])
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { type: "INCOME", invoiceId: null, amount: "330.00", date: { gte: inv.issueDate } }, take: 20,
    }))
  })
})
