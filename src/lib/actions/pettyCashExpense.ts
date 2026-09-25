"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, isAdmin } from "@/lib/roleGuard"
import { toCents } from "@/lib/formatting"
import { calcRunningBalance } from "@/lib/pettyCashLedger"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { sessionDateFromTitle } from "@/lib/formatting"
import { assertUnlocked } from "@/lib/accountingLock"
import { retentionFloor, retentionError } from "@/lib/retention"
import { MONEY_DECIMAL_RE, hasEncryptedFieldMatch } from "@/lib/validation"
import { validateAccount } from "./transaction"
import { validateFund } from "./fund"
import { getCashAccount } from "@/lib/paymentAccounts"
import { createExpenseEntry, revalidatePettyCashPaths, assertSessionOpenTx, SessionClosedError, RECONCILED_EDIT_ERROR, RECONCILED_DELETE_ERROR } from "./pettyCashEntry"
import type { ActionResult } from "./types"

// --- Expenses ---

const ExpenseSchema = z.object({
  payee: z.string().min(1, "Payee is required").max(200),
  accountId: z.string().min(1, "Select a category").transform((v) => parseInt(v, 10)).refine((v) => v > 0, "Select a category"),
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
  description: z.string().min(1, "Description is required").max(500),
  receiptRef: z.string().max(100).optional().transform((v) => v || undefined),
  fundId: z.string().optional().transform((v) => (v && v !== "" ? Number(v) : null)),
  // Likely-duplicate confirmation: set by the "Post anyway" resubmit
  // when createExpense has already warned about a matching prior entry in
  // this session. Never persisted — createExpenseEntry only reads named
  // fields off parsed.data, so this can't leak into the Prisma payload.
  confirmDuplicate: z.string().optional().transform((v) => v === "true"),
  // Negative-float confirmation: set by the "Record anyway" resubmit
  // when the expense would drive the session running balance below zero.
  confirmNegative: z.string().optional().transform((v) => v === "true"),
})

export async function createExpense(
  sessionId: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const existing = await prisma.pettyCashSession.findUnique({
    where: { id: sessionId },
    // Ledger amounts needed for the negative-float check below.
    include: {
      receipts: { select: { amount: true } },
      expenses: { select: { amount: true } },
      transfers: { select: { amount: true } },
    },
  })
  if (!existing) return { error: "Session not found" }
  if (existing.status === "CLOSED") return { error: "Session is closed" }
  const sessionDate = sessionDateFromTitle(existing.title)
  if (!sessionDate) return { error: "Invalid session date" }
  const lockError = await assertUnlocked(sessionDate)
  if (lockError) return { error: lockError }
  const parsed = ExpenseSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const account = await validateAccount(parsed.data.accountId, "EXPENSE")
  if (!account) return { error: "Invalid account" }
  if (parsed.data.fundId != null && !(await validateFund(parsed.data.fundId)))
    return { error: "Invalid fund" }

  // Likely-duplicate guard: a manually-keyed petty-cash expense has no
  // unique constraint guarding against a re-keyed or double-submitted entry —
  // same class of bug closed for the direct transaction route. Warn
  // (don't hard-block) on an existing expense in the SAME session matching
  // date + amount + payee + description. payee/description are encrypted with
  // a random IV, so candidates must be decrypted to compare (same approach as
  // createTransaction). The form resubmits with confirmDuplicate to post it
  // anyway.
  if (!parsed.data.confirmDuplicate) {
    const candidates = (await prisma.pettyCashExpense.findMany({
      where: { sessionId, date: sessionDate, amount: parsed.data.amount },
      select: { payee: true, description: true },
    })) ?? []
    // safeDecrypt (not decrypt) — a corrupt/unrotated-key candidate row must
    // not throw and block this create; it just fails to match.
    const isDuplicate = hasEncryptedFieldMatch(
      candidates,
      [
        ["payee", parsed.data.payee],
        ["description", parsed.data.description],
      ],
      safeDecrypt
    )
    if (isDuplicate) {
      return {
        error: "Possible duplicate: an expense with the same date, amount, payee, and description already exists in this session. Submit again to post it anyway.",
        duplicateWarning: true,
      }
    }
  }

  // Negative-float guard: unlike transfers, expense creation had no
  // running-balance check, so a re-keyed/erroneous expense could drive the
  // session float negative — which then silently blocks all future transfers
  // and inflates EXPENSE in the P&L mirror. Real cash can't go negative, so
  // this is always a data-entry error worth surfacing. Warn, don't hard-block
  // (mirrors the duplicate-warning UX): the "Record anyway" resubmit sets
  // confirmNegative. The balance is a pre-insert read here (not inside the
  // insert tx) — a soft warning, not the hard concurrency guard transfers need.
  if (!parsed.data.confirmNegative) {
    const balance = calcRunningBalance(
      existing.openingBalance,
      existing.receipts,
      existing.expenses,
      existing.transfers
    )
    if (toCents(parsed.data.amount) > toCents(balance)) {
      return {
        error: `This expense of ${parsed.data.amount} exceeds the running balance of ${balance.toFixed(2)} and would make the float negative. Submit again to record it anyway.`,
        negativeBalanceWarning: true,
      }
    }
  }

  // Resolved once, not per row — mirrors the xferAccountId pattern in
  // pettyCashTransfer.ts.
  const cashAccount = await getCashAccount()

  let expenseId: number | undefined
  try {
    await prisma.$transaction(async (tx) => {
      // Re-assert OPEN inside the tx — a concurrent close between the check
      // above and this write must not post into a closed session.
      await assertSessionOpenTx(tx, sessionId)
      expenseId = await createExpenseEntry(tx, {
        sessionId, date: sessionDate, accountId: parsed.data.accountId, accountName: account.name,
        amount: parsed.data.amount, payee: parsed.data.payee, description: parsed.data.description,
        receiptRef: parsed.data.receiptRef, sessionTitle: existing.title, fundId: parsed.data.fundId,
        cashAccountId: cashAccount?.id ?? null,
      })
    })
  } catch (e) {
    if (e instanceof SessionClosedError) return { error: e.message }
    throw e
  }
  await logAudit(actorId(session), "PETTY_CASH_EXPENSE_CREATED", "PettyCashExpense", expenseId, {
    amount: parsed.data.amount,
    accountId: parsed.data.accountId,
    sessionId,
  })
  revalidatePettyCashPaths(sessionId)
  redirect(`/accounting/petty-cash/sessions/${sessionId}`)
}

export async function updateExpense(
  id: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  // canAccessAccounting (ADMIN|PASTOR), matching createExpense. Any editor may correct any
  // entry in an OPEN session — petty-cash sessions are collaborative and both
  // roles are fully-trusted staff; there is deliberately no per-entry ownership
  // (every edit is audited and closed sessions are locked). Delete stays
  // ADMIN-only. By-design, not an IDOR (//AUDIT-033).
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const expense = await prisma.pettyCashExpense.findUnique({
    where: { id },
    include: {
      session: { select: { id: true, status: true, title: true } },
      transaction: { select: { reconciled: true } },
    },
  })
  if (!expense) return { error: "Expense not found" }
  if (expense.session.status === "CLOSED") return { error: "Cannot edit in closed session" }
  if (expense.transaction?.reconciled) return { error: RECONCILED_EDIT_ERROR }
  const sessionDate = sessionDateFromTitle(expense.session.title)
  if (!sessionDate) return { error: "Invalid session date" }
  const lockError = await assertUnlocked(sessionDate)
  if (lockError) return { error: lockError }
  const parsed = ExpenseSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const account = await validateAccount(parsed.data.accountId, "EXPENSE")
  if (!account) return { error: "Invalid account" }
  // allowInactive: editing a historical entry — a fund deactivated after the
  // fact must remain valid.
  if (parsed.data.fundId != null && !(await validateFund(parsed.data.fundId, { allowInactive: true })))
    return { error: "Invalid fund" }
  // confirmDuplicate/confirmNegative are form-only flags — strip
  // them so they can't land in the Prisma update payload; PettyCashExpense has
  // no such column and the spread below would otherwise throw
  // PrismaClientValidationError on every edit.
  const { confirmDuplicate: _cd, confirmNegative: _cn, ...rest } = parsed.data
  // Resolved once, not per row — see createExpense above.
  const cashAccount = await getCashAccount()
  try {
    await prisma.$transaction(async (tx) => {
      // Re-assert OPEN inside the tx — a concurrent close must not let an edit
      // land in a now-closed session.
      await assertSessionOpenTx(tx, expense.sessionId, "Cannot edit in closed session")
      await tx.pettyCashExpense.update({
      where: { id },
      data: {
        ...rest,
        date: sessionDate,
        // payee (recipient) + description are PII-bearing free text — encrypt at rest
        payee: encrypt(parsed.data.payee),
        description: encrypt(parsed.data.description),
        // undefined would keep the old value — map to null so cleared fields clear
        receiptRef: parsed.data.receiptRef ?? null,
      },
    })
    // updateMany: pre- expenses have no mirrored ledger row — must not throw
    await tx.transaction.updateMany({
      where: { pettyCashExpenseId: id },
      data: {
        date: sessionDate,
        amount: parsed.data.amount,
        accountId: parsed.data.accountId,
        description: encrypt(account.name),
        // Re-assert invariants on the mirror so an edit can't drift it off a
        // petty-cash EXPENSE row.
        type: "EXPENSE",
        paymentAccountId: cashAccount?.id ?? null,
        fundId: parsed.data.fundId,
      },
    })
    })
  } catch (e) {
    if (e instanceof SessionClosedError) return { error: e.message }
    throw e
  }
  await logAudit(actorId(session), "PETTY_CASH_EXPENSE_UPDATED", "PettyCashExpense", id, {
    amount: parsed.data.amount,
    accountId: parsed.data.accountId,
    sessionId: expense.sessionId,
  })
  revalidatePettyCashPaths(expense.sessionId)
  redirect(`/accounting/petty-cash/sessions/${expense.sessionId}`)
}

export async function deleteExpense(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const expense = await prisma.pettyCashExpense.findUnique({
    where: { id },
    include: { session: { select: { id: true, status: true, title: true } }, transaction: { select: { id: true, reconciled: true } } },
  })
  if (!expense) return { error: "Expense not found" }
  if (expense.session.status === "CLOSED") return { error: "Cannot delete from closed session" }
  if (expense.transaction?.reconciled) return { error: RECONCILED_DELETE_ERROR }
  if (expense.session.title) {
    const expenseSessionDate = sessionDateFromTitle(expense.session.title)
    if (expenseSessionDate) {
      const lockError = await assertUnlocked(expenseSessionDate)
      if (lockError) return { error: lockError }
    }
  }
  // ATO retention: same fixed 7-year floor as deleteTransaction —
  // independent of the admin-configurable period lock above.
  if (expense.date >= retentionFloor()) return { error: retentionError(expense.date) }
  // Re-assert OPEN + not-reconciled inside the delete transaction — see
  // deleteReceipt; closes the concurrent close/reconcile race left open by.
  try {
    await prisma.$transaction(async (tx) => {
      await assertSessionOpenTx(tx, expense.session.id, "Cannot delete from closed session")
      if (expense.transaction) {
        const mirror = await tx.transaction.findUnique({ where: { id: expense.transaction.id }, select: { reconciled: true } })
        if (mirror?.reconciled) throw new SessionClosedError(RECONCILED_DELETE_ERROR)
      }
      await tx.pettyCashExpense.delete({ where: { id } })
    })
  } catch (e) {
    if (e instanceof SessionClosedError) return { error: e.message }
    throw e
  }
  const userId = actorId(session)
  await logAudit(userId, "PETTY_CASH_EXPENSE_DELETED", "PettyCashExpense", id, {
    amount: Number(expense.amount),
    accountId: expense.accountId,
    sessionId: expense.sessionId,
  })
  // The mirrored ledger row is removed by FK cascade — log it explicitly so the
  // Transaction audit trail doesn't show a ghost deletion.
  if (expense.transaction)
    await logAudit(userId, "TRANSACTION_DELETED", "Transaction", expense.transaction.id, {
      source: "petty-cash", pettyCashExpenseId: id,
    })
  revalidatePettyCashPaths(expense.sessionId)
}
