"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, isAdmin } from "@/lib/roleGuard"
import { toCents } from "@/lib/formatting"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { sessionDateFromTitle } from "@/lib/formatting"
import { assertUnlocked } from "@/lib/accountingLock"
import { retentionFloor, retentionError } from "@/lib/retention"
import { MONEY_DECIMAL_RE } from "@/lib/validation"
import { validateAccount } from "./transaction"
import { validateFund } from "./fund"
import { getCashAccount } from "@/lib/paymentAccounts"
import { createReceiptEntry, revalidatePettyCashPaths, assertSessionOpenTx, SessionClosedError, RECONCILED_EDIT_ERROR, RECONCILED_DELETE_ERROR } from "./pettyCashEntry"
import type { ActionResult } from "./types"

// --- Receipts ---

const ReceiptSchema = z.object({
  accountId: z.string().min(1, "Select a category").transform((v) => parseInt(v, 10)).refine((v) => v > 0, "Select a category"),
  personId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? parseInt(v, 10) : undefined))
    .refine((v) => v === undefined || (Number.isInteger(v) && v > 0), "Invalid donor"),
  serviceTypeId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isInteger(v) && v > 0), "Invalid service type"),
  amount: z
    .string()
    .min(1, "Amount is required")
    // Reject >2dp before parse — the column is Decimal(10,2) and the value is
    // mirrored to the Transaction ledger; silent truncation would corrupt
    // reconciliation (matches openingBalance).
    .refine((v) => MONEY_DECIMAL_RE.test(v), "Amount: max 2 decimal places")
    // Pass the validated string straight to Prisma's Decimal column — never
    // parseFloat into a JS number, which can lose precision on large amounts
    // before storage (matches transaction.ts policy).
    .refine((v) => toCents(v) > 0, "Amount must be positive"),
  notes: z.string().max(500).optional().transform((v) => v || undefined),
  fundId: z.string().optional().transform((v) => (v && v !== "" ? Number(v) : null)),
  // Likely-duplicate confirmation: set by the "Post anyway" resubmit
  // when createReceipt has already warned about a matching prior entry in this
  // session. Never persisted — receiptCreateData only reads named fields off
  // parsed.data, so this can't leak into the Prisma payload.
  confirmDuplicate: z.string().optional().transform((v) => v === "true"),
})

export async function createReceipt(
  sessionId: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const existing = await prisma.pettyCashSession.findUnique({ where: { id: sessionId } })
  if (!existing) return { error: "Session not found" }
  if (existing.status === "CLOSED") return { error: "Session is closed" }
  const sessionDate = sessionDateFromTitle(existing.title)
  if (!sessionDate) return { error: "Invalid session date" }
  const lockError = await assertUnlocked(sessionDate)
  if (lockError) return { error: lockError }
  const parsed = ReceiptSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const account = await validateAccount(parsed.data.accountId, "INCOME")
  if (!account) return { error: "Invalid account" }
  if (parsed.data.fundId != null && !(await validateFund(parsed.data.fundId)))
    return { error: "Invalid fund" }
  if (parsed.data.personId !== undefined) {
    const person = await prisma.person.findUnique({
      where: { id: parsed.data.personId, archivedAt: null },
      select: { id: true },
    })
    if (!person) return { error: "Person not found" }
  }
  if (parsed.data.serviceTypeId !== undefined) {
    const st = await prisma.serviceType.findUnique({
      where: { id: parsed.data.serviceTypeId },
      select: { isActive: true },
    })
    if (!st || !st.isActive) return { error: "Invalid service type" }
  }
  // Likely-duplicate guard: a manually-keyed petty-cash receipt has no
  // unique constraint, so a double-submit silently creates two receipt rows AND
  // two mirrored Transaction ledger rows — inflating the session cash balance
  // and the P&L. Warn (don't hard-block) on an existing receipt in the SAME
  // session matching date + amount + account + donor + notes. Mirrors the
  // createExpense / createTransaction guards. The form resubmits
  // with confirmDuplicate to post it anyway.
  if (!parsed.data.confirmDuplicate) {
    const candidates = await prisma.pettyCashReceipt.findMany({
      where: {
        sessionId, date: sessionDate, amount: parsed.data.amount,
        accountId: parsed.data.accountId, personId: parsed.data.personId ?? null,
      },
      select: { notes: true },
    })
    // notes is encrypted with a random IV, so decrypt candidates to compare.
    // safeDecrypt (not decrypt): a corrupt/unrotated-key row must not throw and
    // block this create; it just fails to match.
    const wantNotes = parsed.data.notes ?? ""
    const isDuplicate = candidates.some((c) => (c.notes ? safeDecrypt(c.notes) : "") === wantNotes)
    if (isDuplicate) {
      return {
        error: "Possible duplicate: a receipt with the same date, amount, category, donor, and notes already exists in this session. Submit again to post it anyway.",
        duplicateWarning: true,
      }
    }
  }

  // Resolved once, not per row — mirrors the xferAccountId pattern in
  // pettyCashTransfer.ts.
  const cashAccount = await getCashAccount()

  let receiptId: number | undefined
  try {
    await prisma.$transaction(async (tx) => {
      // Re-assert OPEN inside the tx — a concurrent close between the check
      // above and this write must not post into a closed session.
      await assertSessionOpenTx(tx, sessionId)
      receiptId = await createReceiptEntry(tx, {
        sessionId, date: sessionDate, accountId: parsed.data.accountId, accountName: account.name,
        amount: parsed.data.amount, personId: parsed.data.personId, serviceTypeId: parsed.data.serviceTypeId,
        notes: parsed.data.notes, sessionTitle: existing.title, fundId: parsed.data.fundId,
        cashAccountId: cashAccount?.id ?? null,
      })
    })
  } catch (e) {
    if (e instanceof SessionClosedError) return { error: e.message }
    throw e
  }
  await logAudit(actorId(session), "PETTY_CASH_RECEIPT_CREATED", "PettyCashReceipt", receiptId, {
    amount: parsed.data.amount,
    accountId: parsed.data.accountId,
    sessionId,
  })
  revalidatePettyCashPaths(sessionId)
  redirect(`/accounting/petty-cash/sessions/${sessionId}`)
}

export async function updateReceipt(
  id: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  // canAccessAccounting (ADMIN|PASTOR), matching createReceipt. Any editor may correct any
  // entry in an OPEN session — petty-cash sessions are collaborative and both
  // roles are fully-trusted staff; there is deliberately no per-entry ownership
  // (every edit is audited and closed sessions are locked). Delete stays
  // ADMIN-only. By-design, not an IDOR (//AUDIT-033).
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const receipt = await prisma.pettyCashReceipt.findUnique({
    where: { id },
    include: {
      session: { select: { id: true, status: true, title: true } },
      transaction: { select: { reconciled: true } },
    },
  })
  if (!receipt) return { error: "Receipt not found" }
  if (receipt.session.status === "CLOSED") return { error: "Cannot edit in closed session" }
  // Editing an entry whose mirror ledger row is reconciled would silently
  // un-balance a reconciled period — the same class of bug closed for the
  // direct transaction route. Force an un-reconcile first.
  if (receipt.transaction?.reconciled) return { error: RECONCILED_EDIT_ERROR }
  const sessionDate = sessionDateFromTitle(receipt.session.title)
  if (!sessionDate) return { error: "Invalid session date" }
  const lockError = await assertUnlocked(sessionDate)
  if (lockError) return { error: lockError }
  const parsed = ReceiptSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const account = await validateAccount(parsed.data.accountId, "INCOME")
  if (!account) return { error: "Invalid account" }
  // allowInactive: editing a historical entry — a fund deactivated after the
  // fact must remain valid.
  if (parsed.data.fundId != null && !(await validateFund(parsed.data.fundId, { allowInactive: true })))
    return { error: "Invalid fund" }
  if (parsed.data.personId !== undefined) {
    const person = await prisma.person.findUnique({
      where: { id: parsed.data.personId, archivedAt: null },
      select: { id: true },
    })
    if (!person) return { error: "Person not found" }
  }
  if (parsed.data.serviceTypeId !== undefined) {
    const st = await prisma.serviceType.findUnique({
      where: { id: parsed.data.serviceTypeId },
      select: { isActive: true },
    })
    if (!st || !st.isActive) return { error: "Invalid service type" }
  }
  // confirmDuplicate is a form-only flag (duplicate-confirmation), not a column —
  // strip it before spreading, or Prisma rejects the whole update.
  const { confirmDuplicate: _confirmDuplicate, ...receiptData } = parsed.data
  // Resolved once, not per row — see createReceipt above.
  const cashAccount = await getCashAccount()
  try {
    await prisma.$transaction(async (tx) => {
      // Re-assert OPEN inside the tx — a concurrent close must not let an edit
      // land in a now-closed session.
      await assertSessionOpenTx(tx, receipt.sessionId, "Cannot edit in closed session")
      await tx.pettyCashReceipt.update({
      where: { id },
      data: {
        ...receiptData,
        date: sessionDate,
        // undefined would keep the old value — map to null so cleared fields clear
        personId: parsed.data.personId ?? null,
        serviceTypeId: parsed.data.serviceTypeId ?? null,
        // notes can carry a donor name — encrypt at rest
        notes: parsed.data.notes ? encrypt(parsed.data.notes) : null,
        fundId: parsed.data.fundId,
      },
    })
    // Resolve the (possibly just-changed) donor's family so the mirror's
    // personId/familyId/isGiving stay in lockstep with the receipt — an edit
    // that changes the donor used to leave these three stale on the ledger
    // row, misstating the per-family Giving Summary. Mirrors
    // createReceiptEntry's resolution (pettyCashEntry.ts).
    const family = parsed.data.personId
      ? await tx.person.findUnique({ where: { id: parsed.data.personId }, select: { familyId: true } })
      : null
    // updateMany: pre- receipts have no mirrored ledger row — must not throw
    await tx.transaction.updateMany({
      where: { pettyCashReceiptId: id },
      data: {
        date: sessionDate,
        amount: parsed.data.amount,
        accountId: parsed.data.accountId,
        description: encrypt(account.name),
        // Re-assert invariants on the mirror so an edit can't drift it off a
        // petty-cash INCOME row.
        type: "INCOME",
        paymentAccountId: cashAccount?.id ?? null,
        fundId: parsed.data.fundId,
        // no donor (or a donor with no family) clears both FKs and
        // isGiving — never left at their pre-edit values.
        personId: parsed.data.personId ?? null,
        familyId: family?.familyId ?? null,
        isGiving: !!family?.familyId,
      },
    })
    })
  } catch (e) {
    if (e instanceof SessionClosedError) return { error: e.message }
    throw e
  }
  await logAudit(actorId(session), "PETTY_CASH_RECEIPT_UPDATED", "PettyCashReceipt", id, {
    amount: parsed.data.amount,
    accountId: parsed.data.accountId,
    sessionId: receipt.sessionId,
  })
  revalidatePettyCashPaths(receipt.sessionId)
  redirect(`/accounting/petty-cash/sessions/${receipt.sessionId}`)
}

export async function deleteReceipt(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const receipt = await prisma.pettyCashReceipt.findUnique({
    where: { id },
    include: { session: { select: { id: true, status: true, title: true } }, transaction: { select: { id: true, reconciled: true } } },
  })
  if (!receipt) return { error: "Receipt not found" }
  if (receipt.session.status === "CLOSED") return { error: "Cannot delete from closed session" }
  if (receipt.transaction?.reconciled) return { error: RECONCILED_DELETE_ERROR }
  if (receipt.session.title) {
    const receiptSessionDate = sessionDateFromTitle(receipt.session.title)
    if (receiptSessionDate) {
      const lockError = await assertUnlocked(receiptSessionDate)
      if (lockError) return { error: lockError }
    }
  }
  // ATO retention: same fixed 7-year floor as deleteTransaction —
  // independent of the admin-configurable period lock above.
  if (receipt.date >= retentionFloor()) return { error: retentionError(receipt.date) }
  // Re-assert OPEN + not-reconciled INSIDE the delete transaction: the
  // checks above run outside any tx, so a concurrent closeSession / reconcile
  // landing in the gap would otherwise let the delete drift a closed session's
  // frozen variance or un-balance a reconciled period — the race already
  // closed for create/update, left open for delete.
  try {
    await prisma.$transaction(async (tx) => {
      await assertSessionOpenTx(tx, receipt.session.id, "Cannot delete from closed session")
      if (receipt.transaction) {
        const mirror = await tx.transaction.findUnique({ where: { id: receipt.transaction.id }, select: { reconciled: true } })
        if (mirror?.reconciled) throw new SessionClosedError(RECONCILED_DELETE_ERROR)
      }
      await tx.pettyCashReceipt.delete({ where: { id } })
    })
  } catch (e) {
    if (e instanceof SessionClosedError) return { error: e.message }
    throw e
  }
  const userId = actorId(session)
  await logAudit(userId, "PETTY_CASH_RECEIPT_DELETED", "PettyCashReceipt", id, {
    amount: Number(receipt.amount),
    accountId: receipt.accountId,
    sessionId: receipt.sessionId,
  })
  // The mirrored ledger row is removed by FK cascade — log it explicitly so the
  // Transaction audit trail doesn't show a ghost deletion.
  if (receipt.transaction)
    await logAudit(userId, "TRANSACTION_DELETED", "Transaction", receipt.transaction.id, {
      source: "petty-cash", pettyCashReceiptId: id,
    })
  revalidatePettyCashPaths(receipt.sessionId)
}
