"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { assertUnlocked } from "@/lib/accountingLock"
import { isRealCalendarDate, isValidPgId } from "@/lib/validation"
import { toCents, fmtAUD, centsToNumber } from "@/lib/formatting"
import { InvoiceStatus } from "@/lib/generated/prisma/enums"
import { sendSingleReceipt } from "@/lib/actions/receipt"

const CHANGED = { error: "This invoice has changed. Reload and try again." }
const BEFORE_ISSUE = { error: "The payment can't be dated before the invoice was issued" }
const REPORT_PATHS = ["/accounting", "/accounting/transactions", "/accounting/reports/pl", "/accounting/reports/balance-sheet", "/accounting/reports/budget-vs-actual", "/accounting/reports/funds"]

export type MarkPaidInput =
  | { mode: "link"; transactionId: number; sendReceipt: boolean }
  | { mode: "create"; date: string; paymentAccountId: number; sendReceipt: boolean }
export type PaymentCandidate = { id: number; date: string; amount: string; reference: string | null; paymentAccountName: string | null }

/** Revalidate invoice pages plus ledger/report pages touched by a payment link change. */
function revalidate(id: number) {
  revalidatePath("/accounting/invoices")
  revalidatePath(`/accounting/invoices/${id}`)
  for (const p of REPORT_PATHS) revalidatePath(p)
}

type SentInvoice = { id: number; invoiceNo: string | null; recipientName: string; personId: number | null; total: { toString(): string }; issueDate: Date; accountId: number; fundId: number | null }

/** Link an existing unlinked income transaction of the exact total; returns its id and date, or an error. */
async function linkExisting(inv: SentInvoice, transactionId: number): Promise<{ txId: number; paidAt: Date } | { error: string }> {
  if (!isValidPgId(transactionId)) return { error: "Invalid transaction" }
  const t = await prisma.transaction.findUnique({ where: { id: transactionId } })
  if (t?.type !== "INCOME" || t.invoiceId !== null) return { error: "Pick an income transaction that is not linked to another invoice" }
  const totalCents = toCents(inv.total.toString())
  if (toCents(t.amount.toString()) !== totalCents) return { error: `The transaction amount must equal the invoice total (${fmtAUD(centsToNumber(totalCents))})` }
  if (t.date < inv.issueDate) return BEFORE_ISSUE
  const lockErr = await assertUnlocked(t.date)
  if (lockErr) return { error: lockErr }
  const ok = await prisma.$transaction(async (tx) => {
    const flip = await tx.invoice.updateMany({ where: { id: inv.id, status: InvoiceStatus.SENT }, data: { status: InvoiceStatus.PAID, paidAt: t.date } })
    if (flip.count === 0) return false
    const linked = await tx.transaction.updateMany({ where: { id: t.id, invoiceId: null }, data: { invoiceId: inv.id } })
    // Throwing rolls back the status flip: someone linked this transaction elsewhere meanwhile.
    if (linked.count === 0) throw new Error("transaction already linked")
    return true
  }).catch(() => false)
  return ok ? { txId: t.id, paidAt: t.date } : CHANGED
}

/** Record a new bank income transaction for the invoice total, posted to the invoice's account/fund. */
async function createPayment(inv: SentInvoice, date: string, paymentAccountId: number): Promise<{ txId: number } | { error: string }> {
  if (!isRealCalendarDate(date)) return { error: "Invalid payment date" }
  const paidAt = new Date(date)
  if (paidAt < inv.issueDate) return BEFORE_ISSUE
  const lockErr = await assertUnlocked(paidAt)
  if (lockErr) return { error: lockErr }
  const pa = isValidPgId(paymentAccountId) ? await prisma.paymentAccount.findUnique({ where: { id: paymentAccountId } }) : null
  if (pa?.kind !== "BANK" || !pa.isActive) return { error: "Choose an active bank account" }
  const acct = await prisma.account.findUnique({ where: { id: inv.accountId } })
  if (acct?.type !== "INCOME" || !acct.isActive) return { error: "The invoice's income account is inactive — reactivate it first" }
  if (inv.fundId !== null) {
    const fund = await prisma.fund.findUnique({ where: { id: inv.fundId } })
    if (!fund?.isActive) return { error: "The invoice's fund is inactive — reactivate it first" }
  }
  const created = await prisma.$transaction(async (tx) => {
    const flip = await tx.invoice.updateMany({ where: { id: inv.id, status: InvoiceStatus.SENT }, data: { status: InvoiceStatus.PAID, paidAt } })
    if (flip.count === 0) return null
    return tx.transaction.create({
      data: {
        date: paidAt, type: "INCOME", amount: inv.total.toString(), accountId: inv.accountId, paymentAccountId: pa.id, fundId: inv.fundId,
        personId: inv.personId, reference: inv.invoiceNo, invoiceId: inv.id,
        description: encrypt(`Invoice ${inv.invoiceNo} — ${inv.recipientName}`),
      },
    })
  })
  return created ? { txId: created.id } : CHANGED
}

/** Mark a SENT invoice paid by linking an existing income transaction or creating one; optionally email a receipt. */
export async function markInvoicePaid(id: number, input: MarkPaidInput): Promise<{ success: string; warning?: string } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const inv = isValidPgId(id) ? await prisma.invoice.findUnique({ where: { id } }) : null
  if (!inv) return { error: "Invoice not found" }
  if (inv.status !== InvoiceStatus.SENT) return { error: "Only sent invoices can be marked paid" }

  const res = input.mode === "link"
    ? await linkExisting(inv, input.transactionId)
    : await createPayment(inv, input.date, input.paymentAccountId)
  if ("error" in res) return res

  await logAudit(actorId(session), "INVOICE_PAID", "Invoice", id, { invoiceNo: inv.invoiceNo, transactionId: res.txId, mode: input.mode })
  revalidate(id)

  const success = `${inv.invoiceNo} marked paid`
  if (!input.sendReceipt) return { success }
  if (!inv.recipientEmail) return { success, warning: "Receipt not sent: no recipient email" }
  const r = await sendSingleReceipt(res.txId, safeDecrypt(inv.recipientEmail))
  return "error" in r ? { success, warning: `Receipt not sent: ${r.error}` } : { success }
}

/** Undo a payment link: PAID → SENT. The transaction stays in the ledger, just unlinked. */
export async function unmarkInvoicePaid(id: number): Promise<{ success: string } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const inv = isValidPgId(id) ? await prisma.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true, paidAt: true } }) : null
  if (inv?.status !== InvoiceStatus.PAID) return { error: "Only paid invoices can be unmarked" }
  // The paid date drives the GST-collected figure, so a locked period's payment stays put.
  if (inv.paidAt) {
    const lockErr = await assertUnlocked(inv.paidAt)
    if (lockErr) return { error: lockErr }
  }
  const ok = await prisma.$transaction(async (tx) => {
    const flip = await tx.invoice.updateMany({ where: { id, status: InvoiceStatus.PAID }, data: { status: InvoiceStatus.SENT, paidAt: null } })
    if (flip.count === 0) return false
    await tx.transaction.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } })
    return true
  })
  if (!ok) return CHANGED
  await logAudit(actorId(session), "INVOICE_UNPAID", "Invoice", id, { invoiceNo: inv.invoiceNo })
  revalidate(id)
  return { success: `Payment unlinked — ${inv.invoiceNo} is unpaid again` }
}

/** Suggest unlinked income transactions matching the invoice total, dated on/after issue. No PII returned. */
export async function listPaymentCandidates(id: number): Promise<PaymentCandidate[] | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const inv = isValidPgId(id) ? await prisma.invoice.findUnique({ where: { id }, select: { total: true, issueDate: true } }) : null
  if (!inv) return { error: "Invoice not found" }
  const rows = await prisma.transaction.findMany({
    where: { type: "INCOME", invoiceId: null, amount: inv.total.toString(), date: { gte: inv.issueDate } },
    orderBy: { date: "desc" }, take: 20,
    select: { id: true, date: true, amount: true, reference: true, paymentAccountRel: { select: { name: true } } },
  })
  return rows.map((r) => ({ id: r.id, date: r.date.toISOString().slice(0, 10), amount: r.amount.toString(), reference: r.reference, paymentAccountName: r.paymentAccountRel?.name ?? null }))
}
