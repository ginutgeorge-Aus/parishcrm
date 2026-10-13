import { markInvoicePaid, unmarkInvoicePaid, listPaymentCandidates } from "@/lib/actions/invoicePayment"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { assertUnlocked, getAccountingLockDate } from "@/lib/accountingLock"
import { sendEmail } from "@/lib/email"
import { logger } from "@/lib/logger"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn(async () => null), getAccountingLockDate: jest.fn(async () => null) }))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn(async () => undefined) }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn() } }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettingsFresh: jest.fn(async () => ({ name: "Live Church" })) }))
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
  personId: null, total: dec("330.00"), issueDate: new Date("2026-10-11"), accountId: 4, fundId: null, issuer: { name: "Example Church" } }
const income = { id: 50, type: "INCOME", invoiceId: null, isGiving: false, accountId: 4, fundId: null, amount: dec("330.00"), date: new Date("2026-10-20"),
  reconciled: false, pettyCashReceiptId: null, pettyCashExpenseId: null, pettyCashTransferId: null, updatedAt: new Date("2026-10-20T01:00:00Z") }
const LINKABLE = { invoiceId: null, isGiving: false, reconciled: false, pettyCashReceiptId: null, pettyCashExpenseId: null, pettyCashTransferId: null }
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
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({ where: { id: 50, ...LINKABLE, updatedAt: income.updatedAt }, data: { invoiceId: 11, accountId: 4, fundId: null } })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "SENT" }, data: { status: "PAID", paidAt: new Date("2026-10-20") } })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_PAID", "Invoice", 11, { invoiceNo: "INV-0007", transactionId: 50, mode: "link" })
    expect(sendEmail).not.toHaveBeenCalled()
  })
  it("recategorises a transaction posted elsewhere to the invoice's account and fund, and audits the move", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...inv, fundId: 3 })
    ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ ...income, accountId: 9, fundId: null })
    expect(await markInvoicePaid(11, link)).toEqual({ success: "INV-0007 marked paid" })
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { invoiceId: 11, accountId: 4, fundId: 3 } }))
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_PAID", "Invoice", 11, { invoiceNo: "INV-0007", transactionId: 50, mode: "link", recategorisedFrom: { accountId: 9, fundId: null } })
  })
  it("refuses to link when the invoice's account is inactive", async () => {
    ;(prisma.account.findUnique as jest.Mock).mockResolvedValueOnce({ id: 4, type: "INCOME", isActive: false })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "The invoice's income account is inactive — reactivate it first" })
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
    ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ ...income, isGiving: true })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "Pick an income transaction that is not linked to another invoice" })
  })
  it.each([["pettyCashReceiptId"], ["pettyCashExpenseId"], ["pettyCashTransferId"]])("rejects a petty-cash mirror (%s)", async (k) => {
    ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ ...income, [k]: 7 })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "Petty cash transactions can't be linked to an invoice" })
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
  })
  it("rejects a reconciled transaction", async () => {
    ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ ...income, reconciled: true })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "This transaction is reconciled. Un-reconcile it on the Reconciliation page before linking." })
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
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
  it("logs and reports a database failure instead of calling it a conflict", async () => {
    ;(prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error("connection lost"))
    expect(await markInvoicePaid(11, link)).toEqual({ error: "Couldn't save the payment. Try again." })
    expect(logger.error).toHaveBeenCalledWith("[invoicePayment] write failed", { message: "connection lost" })
    expect(logAudit).not.toHaveBeenCalled()
  })
})

describe("markInvoicePaid — create", () => {
  const create = { mode: "create" as const, date: "2026-10-20", paymentAccountId: 2, sendReceipt: true }
  it("creates an income transaction, links it, emails a payment-received note", async () => {
    expect(await markInvoicePaid(11, create)).toEqual({ success: "INV-0007 marked paid" })
    expect(prisma.transaction.create).toHaveBeenCalledWith({ data: {
      date: new Date("2026-10-20"), type: "INCOME", amount: "330.00", accountId: 4, paymentAccountId: 2, fundId: null,
      personId: null, reference: "INV-0007", invoiceId: 11, description: "enc:Invoice INV-0007 — Example Scouts",
    } })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_PAID", "Invoice", 11, { invoiceNo: "INV-0007", transactionId: 51, mode: "create" })
    expect(sendEmail).toHaveBeenCalledWith("scouts@example.com", "Payment received — invoice INV-0007",
      expect.stringContaining("Example Church"), expect.stringContaining("We received your payment of $330.00 on 20 October 2026"))
  })
  it("falls back to the live church name when the issuer snapshot has none", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...inv, issuer: null })
    await markInvoicePaid(11, create)
    expect(sendEmail).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(String), expect.stringContaining("Live Church"))
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
  it("warns but keeps PAID when the email fails, without logging the address", async () => {
    ;(sendEmail as jest.Mock).mockRejectedValueOnce(new Error("550 scouts@example.com rejected"))
    expect(await markInvoicePaid(11, create)).toEqual({ success: "INV-0007 marked paid", warning: "Receipt not sent: the email could not be delivered" })
    expect(logger.error).toHaveBeenCalledWith("[invoicePayment] receipt email failed", { invoiceId: 11 })
  })
  it("warns when a receipt is requested but there is no email", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...inv, recipientEmail: null })
    expect(await markInvoicePaid(11, create)).toEqual({ success: "INV-0007 marked paid", warning: "Receipt not sent: no recipient email" })
    expect(sendEmail).not.toHaveBeenCalled()
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
  it("filters unlinked, non-giving income with equal amount on/after issue date", async () => {
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ id: 50, date: new Date("2026-10-20"), amount: dec("330.00"), reference: "INV-0007", paymentAccountRel: { name: "Main" }, account: { name: "Donations" } }])
    expect(await listPaymentCandidates(11)).toEqual([{ id: 50, date: "2026-10-20", amount: "330.00", reference: "INV-0007", paymentAccountName: "Main", accountName: "Donations" }])
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { type: "INCOME", ...LINKABLE, amount: "330.00", date: { gte: inv.issueDate } }, take: 20,
    }))
  })
  it("starts after the lock date when it is later than the issue date", async () => {
    ;(getAccountingLockDate as jest.Mock).mockResolvedValueOnce(new Date("2026-10-15"))
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([])
    await listPaymentCandidates(11)
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ date: { gte: new Date("2026-10-16") } }) }))
  })
  it("returns nothing for an invoice that is no longer SENT", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...inv, status: "PAID" })
    expect(await listPaymentCandidates(11)).toEqual([])
    expect(prisma.transaction.findMany).not.toHaveBeenCalled()
  })
})
