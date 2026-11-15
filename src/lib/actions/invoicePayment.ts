"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAuditGuardedTx, AuditWriteError, auditWriteFailedResult } from "@/lib/auditGuard"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { sendEmail } from "@/lib/email"
import { canAccessAccounting } from "@/lib/roleGuard"
import { assertUnlocked, getAccountingLockDate } from "@/lib/accountingLock"
import { isRealCalendarDate, isValidPgId } from "@/lib/validation"
import { toCents, fmtAUD, centsToNumber, formatLongDate } from "@/lib/formatting"
import { getChurchSettingsFresh } from "@/lib/churchSettings"
import { buildInvoicePaidEmail } from "@/lib/invoiceEmail"
import { InvoiceStatus } from "@/lib/generated/prisma/enums"
import { featureGuard } from "@/lib/featureFlags"

const CHANGED = { error: "This invoice has changed. Reload and try again." }
const BEFORE_ISSUE = { error: "The payment can't be dated before the invoice was issued" }
const REPORT_PATHS = ["/accounting", "/accounting/transactions", "/accounting/reports/pl", "/accounting/reports/balance-sheet", "/accounting/reports/budget-vs-actual", "/accounting/reports/funds"]

export type MarkPaidInput =
  | { mode: "link"; transactionId: number; sendReceipt: boolean }
  | { mode: "create"; date: string; paymentAccountId: number; sendReceipt: boolean }
export type PaymentCandidate = { id: number; date: string; amount: string; reference: string | null; paymentAccountName: string | null; accountName: string }

/** Rows a payment link may claim: unlinked, non-giving, unreconciled, and not a petty-cash mirror (edited via its session). */
const LINKABLE = { invoiceId: null, isGiving: false, reconciled: false, pettyCashReceiptId: null, pettyCashExpenseId: null, pettyCashTransferId: null }

/** Thrown inside a DB transaction to roll back when a guarded write matched no rows (a concurrent change). */
class Conflict extends Error {}

/** Revalidate invoice pages plus ledger/report pages touched by a payment link change. */
function revalidate(id: number) {
  revalidatePath("/accounting/invoices")
  revalidatePath(`/accounting/invoices/${id}`)
  for (const p of REPORT_PATHS) revalidatePath(p)
}

type SentInvoice = {
  id: number; invoiceNo: string | null; recipientName: string; recipientEmail: string | null; personId: number | null
  total: { toString(): string }; issueDate: Date; accountId: number; fundId: number | null; issuer: unknown
}

/** The payment is posted to the invoice's income account and fund, so both must still be usable. */
async function postingTargetError(inv: SentInvoice): Promise<string | null> {
  const acct = await prisma.account.findUnique({ where: { id: inv.accountId } })
  if (acct?.type !== "INCOME" || !acct.isActive) return "The invoice's income account is inactive — reactivate it first"
  if (inv.fundId !== null) {
    const fund = await prisma.fund.findUnique({ where: { id: inv.fundId } })
    if (!fund?.isActive) return "The invoice's fund is inactive — reactivate it first"
  }
  return null
}

/** Run a guarded write; a Conflict maps to CHANGED, anything else is logged and reported as a failure. */
async function guarded<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof Conflict) return CHANGED
    // The in-transaction audit write failed, so the payment write rolled back with it.
    if (e instanceof AuditWriteError) return auditWriteFailedResult(e, "invoicePayment")
    logger.error("[invoicePayment] write failed", { message: e instanceof Error ? e.message : "unknown" })
    return { error: "Couldn't save the payment. Try again." }
  }
}

/**
 * Link an existing unlinked, non-giving income transaction of the exact total. Linking recategorises it to the
 * invoice's income account and fund, so the income is reported the same way as a newly recorded payment.
 * The INVOICE_PAID audit row is written in the same transaction as the link.
 * @param uid acting user id (resolved before the transaction)
 */
async function linkExisting(inv: SentInvoice, transactionId: number, uid: number | null): Promise<{ txId: number; paidAt: Date; moved: { accountId: number; fundId: number | null } | null } | { error: string }> {
  if (!isValidPgId(transactionId)) return { error: "Invalid transaction" }
  const t = await prisma.transaction.findUnique({ where: { id: transactionId } })
  if (t?.type !== "INCOME" || t.invoiceId !== null || t.isGiving) return { error: "Pick an income transaction that is not linked to another invoice" }
  if (t.pettyCashReceiptId !== null || t.pettyCashExpenseId !== null || t.pettyCashTransferId !== null)
    return { error: "Petty cash transactions can't be linked to an invoice" }
  if (t.reconciled) return { error: "This transaction is reconciled. Un-reconcile it on the Reconciliation page before linking." }
  const totalCents = toCents(inv.total.toString())
  if (toCents(t.amount.toString()) !== totalCents) return { error: `The transaction amount must equal the invoice total (${fmtAUD(centsToNumber(totalCents))})` }
  if (t.date < inv.issueDate) return BEFORE_ISSUE
  const lockErr = await assertUnlocked(t.date)
  if (lockErr) return { error: lockErr }
  const targetErr = await postingTargetError(inv)
  if (targetErr) return { error: targetErr }
  const moved = t.accountId !== inv.accountId || t.fundId !== inv.fundId ? { accountId: t.accountId, fundId: t.fundId } : null
  const res = await guarded(() => prisma.$transaction(async (tx) => {
    const flip = await tx.invoice.updateMany({ where: { id: inv.id, status: InvoiceStatus.SENT }, data: { status: InvoiceStatus.PAID, paidAt: t.date } })
    if (flip.count === 0) throw new Conflict()
    const linked = await tx.transaction.updateMany({
      // updatedAt: an edit committed since the read above (amount, date, type) rolls the link back.
      where: { id: t.id, ...LINKABLE, updatedAt: t.updatedAt },
      data: { invoiceId: inv.id, accountId: inv.accountId, fundId: inv.fundId },
    })
    // Throwing rolls back the status flip: the transaction was linked, reconciled or edited meanwhile.
    if (linked.count === 0) throw new Conflict()
    await logAuditGuardedTx(tx, uid, "INVOICE_PAID", "Invoice", inv.id, {
      invoiceNo: inv.invoiceNo, transactionId: t.id, mode: "link", ...(moved ? { recategorisedFrom: moved } : {}),
    })
    return true
  }))
  return typeof res === "object" ? res : { txId: t.id, paidAt: t.date, moved }
}

/**
 * Record a new bank income transaction for the invoice total, posted to the invoice's account/fund.
 * The INVOICE_PAID audit row is written in the same transaction as the payment.
 * @param uid acting user id (resolved before the transaction)
 */
async function createPayment(inv: SentInvoice, date: string, paymentAccountId: number, uid: number | null): Promise<{ txId: number; paidAt: Date } | { error: string }> {
  if (!isRealCalendarDate(date)) return { error: "Invalid payment date" }
  const paidAt = new Date(date)
  if (paidAt < inv.issueDate) return BEFORE_ISSUE
  const lockErr = await assertUnlocked(paidAt)
  if (lockErr) return { error: lockErr }
  const pa = isValidPgId(paymentAccountId) ? await prisma.paymentAccount.findUnique({ where: { id: paymentAccountId } }) : null
  if (pa?.kind !== "BANK" || !pa.isActive) return { error: "Choose an active bank account" }
  const targetErr = await postingTargetError(inv)
  if (targetErr) return { error: targetErr }
  // Encrypt before the transaction so the row locks aren't held during slow work.
  const description = encrypt(`Invoice ${inv.invoiceNo} — ${inv.recipientName}`)
  const created = await guarded(() => prisma.$transaction(async (tx) => {
    const flip = await tx.invoice.updateMany({ where: { id: inv.id, status: InvoiceStatus.SENT }, data: { status: InvoiceStatus.PAID, paidAt } })
    if (flip.count === 0) throw new Conflict()
    const row = await tx.transaction.create({
      data: {
        date: paidAt, type: "INCOME", amount: inv.total.toString(), accountId: inv.accountId, paymentAccountId: pa.id, fundId: inv.fundId,
        personId: inv.personId, reference: inv.invoiceNo ? encrypt(inv.invoiceNo) : null, invoiceId: inv.id,
        description,
      },
    })
    await logAuditGuardedTx(tx, uid, "INVOICE_PAID", "Invoice", inv.id, { invoiceNo: inv.invoiceNo, transactionId: row.id, mode: "create" })
    return row
  }))
  return "error" in created ? created : { txId: created.id, paidAt }
}

/** Email the invoice recipient a payment-received note. Returns a warning string when it can't be sent. */
async function sendPaidEmail(inv: SentInvoice, paidAt: Date): Promise<string | undefined> {
  if (!inv.recipientEmail) return "Receipt not sent: no recipient email"
  const frozen = (inv.issuer ?? {}) as { name?: unknown }
  const churchName = typeof frozen.name === "string" && frozen.name ? frozen.name : (await getChurchSettingsFresh()).name
  const mail = buildInvoicePaidEmail({
    churchName, recipientName: inv.recipientName, invoiceNo: inv.invoiceNo ?? "",
    total: fmtAUD(centsToNumber(toCents(inv.total.toString()))), paidDate: formatLongDate(paidAt),
  })
  try {
    await sendEmail(safeDecrypt(inv.recipientEmail), mail.subject, mail.html, mail.text)
    return undefined
  } catch {
    // Never log the raw error — SMTP messages embed the recipient address.
    logger.error("[invoicePayment] receipt email failed", { invoiceId: inv.id })
    return "Receipt not sent: the email could not be delivered"
  }
}

/** Mark a SENT invoice paid by linking an existing income transaction or creating one; optionally email the recipient. */
export async function markInvoicePaid(id: number, input: MarkPaidInput): Promise<{ success: string; warning?: string } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("invoices")
  if (off) return off
  const inv = isValidPgId(id) ? await prisma.invoice.findUnique({ where: { id }, omit: { frozenPdf: true } }) : null
  if (!inv) return { error: "Invoice not found" }
  if (inv.status !== InvoiceStatus.SENT) return { error: "Only sent invoices can be marked paid" }

  const uid = actorId(session)
  const res = input.mode === "link"
    ? await linkExisting(inv, input.transactionId, uid)
    : await createPayment(inv, input.date, input.paymentAccountId, uid)
  if ("error" in res) return res

  revalidate(id)

  const success = `${inv.invoiceNo} marked paid`
  const warning = input.sendReceipt ? await sendPaidEmail(inv, res.paidAt) : undefined
  return warning ? { success, warning } : { success }
}

/** Undo a payment link: PAID → SENT. The transaction stays in the ledger, just unlinked. */
export async function unmarkInvoicePaid(id: number): Promise<{ success: string } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("invoices")
  if (off) return off
  const inv = isValidPgId(id) ? await prisma.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true, paidAt: true } }) : null
  if (inv?.status !== InvoiceStatus.PAID) return { error: "Only paid invoices can be unmarked" }
  // The paid date drives the GST-collected figure, so a locked period's payment stays put.
  if (inv.paidAt) {
    const lockErr = await assertUnlocked(inv.paidAt)
    if (lockErr) return { error: lockErr }
  }
  const uid = actorId(session)
  const ok = await guarded(() => prisma.$transaction(async (tx) => {
    const flip = await tx.invoice.updateMany({ where: { id, status: InvoiceStatus.PAID }, data: { status: InvoiceStatus.SENT, paidAt: null } })
    if (flip.count === 0) throw new Conflict()
    await tx.transaction.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } })
    await logAuditGuardedTx(tx, uid, "INVOICE_UNPAID", "Invoice", id, { invoiceNo: inv.invoiceNo })
    return true
  }))
  if (typeof ok === "object") return ok
  revalidate(id)
  return { success: `Payment unlinked — ${inv.invoiceNo} is unpaid again` }
}

/**
 * Suggest income transactions that could pay a SENT invoice: exact total, unlinked, not giving, dated on/after
 * issue and outside the locked period. No PII returned.
 */
export async function listPaymentCandidates(id: number): Promise<PaymentCandidate[] | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("invoices")
  if (off) return off
  const inv = isValidPgId(id) ? await prisma.invoice.findUnique({ where: { id }, select: { status: true, total: true, issueDate: true } }) : null
  if (!inv) return { error: "Invoice not found" }
  if (inv.status !== InvoiceStatus.SENT) return []
  const lock = await getAccountingLockDate()
  // The lock is inclusive of its calendar day: only rows dated on the following day or later are editable.
  const afterLock = lock ? new Date(lock.getTime() + 86_400_000) : null
  const from = afterLock && afterLock > inv.issueDate ? afterLock : inv.issueDate
  const rows = await prisma.transaction.findMany({
    where: { type: "INCOME", ...LINKABLE, amount: inv.total.toString(), date: { gte: from } },
    orderBy: { date: "desc" }, take: 20,
    select: { id: true, date: true, amount: true, reference: true, paymentAccountRel: { select: { name: true } }, account: { select: { name: true } } },
  })
  return rows.map((r) => ({
    id: r.id, date: r.date.toISOString().slice(0, 10), amount: r.amount.toString(), reference: r.reference ? safeDecrypt(r.reference) : null,
    paymentAccountName: r.paymentAccountRel?.name ?? null, accountName: r.account.name,
  }))
}
