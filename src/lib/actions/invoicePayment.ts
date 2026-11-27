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
import { assertUnlocked, assertUnlockedTx, getAccountingLockDate } from "@/lib/accountingLock"
import { isRealCalendarDate, isValidPgId } from "@/lib/validation"
import { toCents, fmtAUD, centsToNumber, formatLongDate } from "@/lib/formatting"
import { getChurchSettingsFresh } from "@/lib/churchSettings"
import { buildInvoicePaidEmail } from "@/lib/invoiceEmail"
import { InvoiceStatus } from "@/lib/generated/prisma/enums"
import type { Prisma } from "@/lib/generated/prisma/client"
import { featureGuard } from "@/lib/featureFlags"
import { NOT_XFER, XFER_CODE } from "@/lib/xferAccount"
import { sydneyToday } from "@/lib/dates"

const CHANGED = { error: "This invoice has changed. Reload and try again." }
const RECONCILED_UNMARK = "The payment is reconciled. Un-reconcile it on the Reconciliation page before unmarking."
const NO_PAID_AUDIT = "This payment has no audit record of how it was created, so it can't be unmarked automatically. Ask an administrator to fix the transaction manually."
const BEFORE_ISSUE = { error: "The payment can't be dated before the invoice was issued" }
const REPORT_PATHS = ["/accounting", "/accounting/transactions", "/accounting/reports/pl", "/accounting/reports/balance-sheet", "/accounting/reports/budget-vs-actual", "/accounting/reports/funds"]

export type MarkPaidInput =
  | { mode: "link"; transactionId: number; sendReceipt: boolean }
  | { mode: "create"; date: string; paymentAccountId: number; sendReceipt: boolean }
export type PaymentCandidate = { id: number; date: string; amount: string; reference: string | null; paymentAccountName: string | null; accountName: string }

/** Rows a payment link may claim: unlinked, non-giving, unreconciled, not a petty-cash mirror (edited via its session) and not an internal-transfer leg. */
const LINKABLE = { invoiceId: null, isGiving: false, reconciled: false, pettyCashReceiptId: null, pettyCashExpenseId: null, pettyCashTransferId: null, ...NOT_XFER }

/** Ids among `ids` that an invoice-unmark reversal already offsets (audited on the reversal row): re-linking one would mark an invoice paid with net-zero income. */
async function reversedIds(db: Pick<typeof prisma, "auditLog">, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set()
  const rows = await db.auditLog.findMany({
    where: { action: "TRANSACTION_CREATED", resourceType: "Transaction", OR: ids.map((n) => ({ metadata: { path: ["reversesTransactionId"], equals: n } })) },
    select: { metadata: true },
  })
  return new Set(rows.map((r) => (r.metadata as { reversesTransactionId?: unknown } | null)?.reversesTransactionId).filter((v): v is number => typeof v === "number"))
}

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

/** A posting (payment or its reversal) lands on an income account and fund, so both must still be usable. */
async function targetError(db: Pick<typeof prisma, "account" | "fund">, accountId: number, fundId: number | null): Promise<string | null> {
  const acct = await db.account.findUnique({ where: { id: accountId } })
  if (acct?.type !== "INCOME" || !acct.isActive) return "The invoice's income account is inactive — reactivate it first"
  if (fundId !== null) {
    const fund = await db.fund.findUnique({ where: { id: fundId } })
    if (!fund?.isActive) return "The invoice's fund is inactive — reactivate it first"
  }
  return null
}

/** The payment is posted to the invoice's income account and fund. */
const postingTargetError = (inv: SentInvoice) => targetError(prisma, inv.accountId, inv.fundId)

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
  const t = await prisma.transaction.findUnique({ where: { id: transactionId }, include: { account: { select: { code: true } } } })
  if (t?.type !== "INCOME" || t.invoiceId !== null || t.isGiving || t.account?.code === XFER_CODE) return { error: "Pick an income transaction that is not linked to another invoice" }
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
    // Invoice lock first, so the reversed-row check below and the flip see one state.
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${inv.id} FOR UPDATE` // nosemgrep: crm-no-raw-sql
    if ((await reversedIds(tx, [t.id])).size > 0) return { error: "This transaction was reversed when an invoice was unmarked paid. Record a new payment instead." }
    // Period-lock re-check inside the write (AUD-3-08); reconciled is re-checked by the LINKABLE predicate below.
    const txLockErr = await assertUnlockedTx(tx, t.date)
    if (txLockErr) return { error: txLockErr }
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
    // Period-lock re-check inside the write (AUD-3-08): a lock set after the pre-check must still block it.
    const txLockErr = await assertUnlockedTx(tx, paidAt)
    if (txLockErr) return { error: txLockErr }
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

/**
 * Lock check for a payment's own date during unmark; the message says why the unmark is refused.
 * Runs inside the unmark transaction and holds the shared accounting lock until it commits (AUD-3-08).
 * @param tx the unmark's transaction client
 * @param date the payment date, or null (nothing to check)
 */
async function lockedPaymentError(tx: Prisma.TransactionClient, date: Date | null): Promise<string | null> {
  if (!date) return null
  const lockErr = await assertUnlockedTx(tx, date)
  return lockErr ? `The payment is in a locked accounting period, so it can't be unmarked. ${lockErr}` : null
}

/**
 * Undo a payment: PAID → SENT. How the ledger row is handled depends on how it got there (read from the INVOICE_PAID audit row):
 * a row the invoice created is kept (7-year retention) but unlinked, and an offsetting negative INCOME row dated today is added
 * (a plain delete would drop the record; leaving it linked would double the income when the invoice is marked paid again, or leave
 * income for a voided invoice); a row the invoice linked is unlinked and moved back to its previous account and fund.
 * The payment's own period (paidAt) and today's period must both be open. A row with no INVOICE_PAID audit row is only unlinked
 * when it has no payment account (an invoice-created payment always has one); otherwise it is refused.
 * Exceptions: a reconciled linked row, or one whose recorded account/fund no longer exists, is unlinked but keeps its current category.
 * The reversal only ever targets the transaction id recorded in the INVOICE_PAID audit row. The reversal is negative INCOME,
 * not EXPENSE: EXPENSE rows must sit on EXPENSE accounts and would inflate expense totals instead of netting the income.
 */
export async function unmarkInvoicePaid(id: number): Promise<{ success: string } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("invoices")
  if (off) return off
  const inv = isValidPgId(id) ? await prisma.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true, paidAt: true } }) : null
  if (inv?.status !== InvoiceStatus.PAID) return { error: "Only paid invoices can be unmarked" }
  // The reversal row is dated today (Sydney); a locked period must never receive a row.
  const reversalDate = sydneyToday()
  const uid = actorId(session)
  const ok = await guarded(() => prisma.$transaction(async (tx) => {
    // Lock the invoice first so the audit/row reads and the flip see one state (concurrent unmark + re-mark waits here).
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE` // nosemgrep: crm-no-raw-sql
    // paidAt is re-read under the lock: the pre-transaction read can be stale if a concurrent unmark + re-mark changed it.
    const fresh = await tx.invoice.findUnique({ where: { id }, select: { status: true, paidAt: true } })
    if (fresh?.status !== InvoiceStatus.PAID) throw new Conflict()
    const paidAt = fresh.paidAt
    const paid = await tx.auditLog.findFirst({ where: { action: "INVOICE_PAID", resourceType: "Invoice", resourceId: id }, orderBy: { id: "desc" }, select: { metadata: true } })
    const meta = (paid?.metadata ?? {}) as { mode?: unknown; transactionId?: unknown; recategorisedFrom?: { accountId?: unknown; fundId?: unknown } }
    const row = await tx.transaction.findFirst({ where: { invoiceId: id }, select: { id: true, date: true, reconciled: true, amount: true, accountId: true, paymentAccountId: true, fundId: true, personId: true } })
    // Checked before any write: returning an error doesn't roll the transaction back.
    // No INVOICE_PAID audit row: how the row got there is unknown. An invoice-created payment always has a payment account, so a row
    // without one can't be one: unlinking it only frees a pre-existing income row (same as a link-mode unmark), which can't double.
    // A row with a payment account might be an unrecorded created payment: unlinking it would leave income that doubles on re-mark. Refuse.
    if (row && !paid && row.paymentAccountId !== null) return { error: NO_PAID_AUDIT }
    const createMode = !!row && meta.mode === "create"
    if (row?.reconciled && createMode) return { error: RECONCILED_UNMARK }
    // Unmarking clears paidAt, which drops the invoice's GST-collected from the period it was paid in (getInvoiceSummary), so that period
    // must be open. A created payment also gets a reversal row dated today, so today's period must be open too, and so must the
    // payment row's own date (equal to paidAt for a created payment; checked so the original is never in a locked period below).
    const lockErr = createMode
      ? await assertUnlockedTx(tx, reversalDate) ?? (await lockedPaymentError(tx, paidAt) ?? (row ? await lockedPaymentError(tx, row.date) : null))
      : paidAt ? await assertUnlockedTx(tx, paidAt) : null
    if (lockErr) return { error: lockErr }
    // The reversal posts to the payment's own account and fund: both must still be usable.
    if (row && createMode) {
      const targetErr = await targetError(tx, row.accountId, row.fundId)
      if (targetErr) return { error: targetErr }
    }
    // Only ever reverse the exact row this INVOICE_PAID event created: an unmark + re-mark (link) between the audit read and the row read
    // could otherwise leave a different, unrelated transaction linked while the stale `create` mode still applies.
    // Link mode too: a concurrent unmark + re-mark could swap in a different row, which would be unlinked and left as income.
    // A create-mode audit row without a numeric id (older rows) can't be checked that way: the row linked to this locked invoice is
    // taken as the payment, and the unlink below is guarded by its payment account (a created payment always has one).
    if (row && (meta.mode === "link" || meta.mode === "create") && typeof meta.transactionId === "number" && meta.transactionId !== row.id) throw new Conflict()
    if (row && meta.mode === "create" && typeof meta.transactionId !== "number" && row.paymentAccountId === null) return { error: NO_PAID_AUDIT }
    const flip = await tx.invoice.updateMany({ where: { id, status: InvoiceStatus.PAID }, data: { status: InvoiceStatus.SENT, paidAt: null } })
    if (flip.count === 0) throw new Conflict()
    let reversalId: number | undefined
    let restoredTo: { accountId: number; fundId: number | null } | undefined
    if (row && createMode) {
      // Reconciled rows are refused above; the predicate also catches one reconciled since the read.
      // The original stays as the record; clearing invoiceId frees the unique link so the invoice can be paid again.
      // The pair nets to zero, so both rows are marked reconciled: neither shows as unmatched on the bank reconciliation page, and
      // editing or deleting one half is blocked. The original's date was checked unlocked above, so it can always be flagged.
      const unlink = await tx.transaction.updateMany({
        where: { id: row.id, invoiceId: id, paymentAccountId: row.paymentAccountId, reconciled: false },
        data: { invoiceId: null, reconciled: true },
      })
      if (unlink.count === 0) throw new Conflict()
      const reversal = await tx.transaction.create({
        data: {
          date: reversalDate, type: "INCOME", amount: `-${row.amount.toString()}`, accountId: row.accountId,
          paymentAccountId: row.paymentAccountId, fundId: row.fundId, personId: row.personId, reconciled: true,
          reference: inv.invoiceNo ? encrypt(inv.invoiceNo) : null,
          description: encrypt(`Reversal of ${inv.invoiceNo} payment`), notes: encrypt(`Reverses transaction #${row.id}`),
        },
        select: { id: true },
      })
      reversalId = reversal.id
      // Same trail as a manual create, so the offsetting row is attributable and linked to the payment it reverses.
      await logAuditGuardedTx(tx, uid, "TRANSACTION_CREATED", "Transaction", reversal.id, {
        amount: `-${row.amount.toString()}`, type: "INCOME", accountId: row.accountId, source: "invoice-unmark", invoiceId: id, reversesTransactionId: row.id,
      })
    } else if (row) {
      // Only restore a category recorded for this exact row: a stale audit read (concurrent unmark + re-link) must not recategorise another transaction.
      const from = meta.transactionId === row.id ? meta.recategorisedFrom : undefined
      const prev = typeof from?.accountId === "number" && (from.fundId === null || typeof from.fundId === "number") ? { accountId: from.accountId, fundId: from.fundId } : undefined
      // The recorded account/fund may have been deleted since (delete guards ignore audit metadata): then unlink and keep the current category.
      const targetsExist = prev
        ? !!(await tx.account.findUnique({ where: { id: prev.accountId }, select: { id: true } }))
          && (prev.fundId === null || !!(await tx.fund.findUnique({ where: { id: prev.fundId }, select: { id: true } })))
        : false
      // A reconciled row can't be edited, so it is unlinked but keeps its current category.
      const restore = prev && targetsExist && !row.reconciled
      const upd = await tx.transaction.updateMany({
        where: { id: row.id, invoiceId: id, ...(restore ? { reconciled: false } : {}) },
        data: restore ? { invoiceId: null, ...prev } : { invoiceId: null },
      })
      if (upd.count === 0) throw new Conflict()
      if (restore) restoredTo = prev
    }
    await logAuditGuardedTx(tx, uid, "INVOICE_UNPAID", "Invoice", id, {
      invoiceNo: inv.invoiceNo, ...(row ? { transactionId: row.id, ...(reversalId ? { reversalTransactionId: reversalId } : {}) } : {}), ...(restoredTo ? { restoredTo } : {}),
    })
    return { reversed: reversalId !== undefined }
  }))
  if ("error" in ok) return { error: ok.error as string }
  revalidate(id)
  return { success: ok.reversed ? `Payment kept and cancelled by a negative entry dated today — ${inv.invoiceNo} is unpaid again` : `Payment unlinked — ${inv.invoiceNo} is unpaid again` }
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
  const reversed = await reversedIds(prisma, rows.map((r) => r.id))
  return rows.filter((r) => !reversed.has(r.id)).map((r) => ({
    id: r.id, date: r.date.toISOString().slice(0, 10), amount: r.amount.toString(), reference: r.reference ? safeDecrypt(r.reference) : null,
    paymentAccountName: r.paymentAccountRel?.name ?? null, accountName: r.account.name,
  }))
}
