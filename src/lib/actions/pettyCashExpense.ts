"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, isAdmin } from "@/lib/roleGuard"
import { toCents, sessionDateFromTitle } from "@/lib/formatting"
import { calcRunningBalance } from "@/lib/pettyCashLedger"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { logPettyCashEntryAuditTx, logPettyCashEntryDeletedAuditTx } from "@/lib/pettyCashAuditTx"
import { assertUnlocked, assertUnlockedTx, holdAccountingLock } from "@/lib/accountingLock"
import { retentionFloor, retentionError } from "@/lib/retention"
import { MONEY_DECIMAL_RE, isOversizeMoney, hasEncryptedFieldMatch, isP2034, isValidPgId } from "@/lib/validation"
import type { Prisma } from "@/lib/generated/prisma/client"
import { validateAccount } from "./transaction"
import { accountMatches } from "@/lib/accountMatches"
import { serializableWrite } from "@/lib/serializableWrite"
import { validateFund } from "./fund"
import { getCashAccount } from "@/lib/paymentAccounts"
import { createExpenseEntry, revalidatePettyCashPaths, PETTY_CASH_BUSY, PETTY_CASH_GONE, assertSessionOpenTx, assertMirrorNotReconciledTx, SessionClosedError, RECONCILED_EDIT_ERROR, RECONCILED_DELETE_ERROR, SUBMISSION_TOKEN_REUSED_ERROR, parseSubmissionToken, type SubmissionTokenLookup } from "./pettyCashEntry"
import { makeReplayDone, makeOrReplay, resolveCreateWriteError, AuditWriteError, auditFailed } from "./pettyCashWriteErrors"
import type { ActionResult } from "./types"
import { featureGuard } from "@/lib/featureFlags"
import { optionalPgIdFormField, pgIdFormField } from "@/lib/formFieldSchemas"

// --- Expenses ---

const ExpenseSchema = z.object({
  payee: z.string().min(1, "Payee is required").max(200),
  accountId: pgIdFormField("Select a category"),
  amount: z
    .string()
    .min(1, "Amount is required")
    // Reject >2dp before parse — the column is Decimal(10,2) and the value is
    // mirrored to the Transaction ledger; silent truncation would corrupt
    // reconciliation (matches openingBalance).
    .refine((v) => MONEY_DECIMAL_RE.test(v), "Amount: max 2 decimal places")
    .refine((v) => !isOversizeMoney(v), "Amount too large (max 99,999,999.99)")
    // Pass the validated string straight to Prisma's Decimal column — never
    // parseFloat into a JS number, which can lose precision on large amounts
    // before storage (matches transaction.ts policy).
    .refine((v) => toCents(v) > 0, "Amount must be positive"),
  description: z.string().min(1, "Description is required").max(500),
  receiptRef: z.string().max(100).optional().transform((v) => v || undefined),
  fundId: optionalPgIdFormField("Invalid fund", null),
  // Likely-duplicate confirmation: set by the "Post anyway" resubmit
  // when createExpense has already warned about a matching prior entry in
  // this session. Never persisted — createExpenseEntry only reads named
  // fields off parsed.data, so this can't leak into the Prisma payload.
  confirmDuplicate: z.string().optional().transform((v) => v === "true"),
  // Negative-float confirmation: set by the "Record anyway" resubmit
  // when the expense would drive the session running balance below zero.
  confirmNegative: z.string().optional().transform((v) => v === "true"),
})

/**
 * Soft-warning text when an expense (new or edited) is larger than the cash available for it.
 * @param amount the submitted expense amount
 * @param available running balance before this expense (dollars)
 */
function negativeFloatWarning(amount: string, available: number): string {
  return `This expense of ${amount} exceeds the running balance of ${available.toFixed(2)} and would make the float negative. Submit again to record it anyway.`
}

// Loads the session (with the ledger rows needed for the negative-float check)
// and runs the open/dated/lock checks shared by createExpense's setup —
// bundled so the caller sees one guard clause instead of four.
async function loadOpenExpenseSession(sessionId: number) {
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
  return { existing, sessionDate }
}

// Likely-duplicate check factored out of createExpense: an existing expense in
// the SAME session matching date + amount + payee + description. payee/description
// are encrypted with a random IV, so candidates must be decrypted to compare
// (same approach as createTransaction).
async function isDuplicateExpense(
  sessionId: number,
  sessionDate: Date,
  data: { amount: string; payee: string; description: string }
): Promise<boolean> {
  const candidates = (await prisma.pettyCashExpense.findMany({
    where: { sessionId, date: sessionDate, amount: data.amount },
    select: { payee: true, description: true },
  })) ?? []
  // safeDecrypt (not decrypt) — a corrupt/unrotated-key candidate row must
  // not throw and block this create; it just fails to match.
  return hasEncryptedFieldMatch(
    candidates,
    [
      ["payee", data.payee],
      ["description", data.description],
    ],
    safeDecrypt
  )
}

/** The submitted expense fields compared against a stored expense to decide replay vs reuse. */
type ExpenseSubmission = {
  sessionId: number
  amount: string
  accountId: number
  payee: string
  description: string
  receiptRef: string | undefined
  fundId: number | null
}

/**
 * Looks up the expense already carrying this form submission token (#487).
 * "replay" only when every persisted field of the submission matches the stored
 * expense (the date is fixed by the session): Back/forward can restore a cached
 * form with its old token, and an edited expense entered there must not be
 * silently dropped — that is "reused". Runs before the duplicate/negative-float
 * warnings, inside the write transaction, and after a P2002 on the token's
 * unique index.
 */
async function expenseTokenState(
  db: Pick<Prisma.TransactionClient, "pettyCashExpense">,
  token: string,
  sub: ExpenseSubmission,
): Promise<SubmissionTokenLookup> {
  const prior = await db.pettyCashExpense.findUnique({
    where: { submissionToken: token },
    select: { id: true, sessionId: true, amount: true, accountId: true, payee: true, description: true, receiptRef: true, fundId: true },
  })
  if (!prior) return { state: "unused" }
  const same =
    prior.sessionId === sub.sessionId &&
    toCents(String(prior.amount)) === toCents(sub.amount) &&
    prior.accountId === sub.accountId &&
    safeDecrypt(prior.payee) === sub.payee &&
    safeDecrypt(prior.description) === sub.description &&
    (prior.receiptRef ?? undefined) === sub.receiptRef &&
    (prior.fundId ?? null) === sub.fundId
  return { state: same ? "replay" : "reused", id: prior.id }
}

/**
 * Record a petty cash expense. ADMIN/PASTOR only. A replayed submission (same
 * form `submissionToken` as a committed expense) redirects to the session
 * without creating a second expense or ledger mirror (#487).
 */
export async function createExpense(
  sessionId: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("pettyCash")
  if (off) return off
  const parsed = ExpenseSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const tokenParsed = parseSubmissionToken(formData)
  if ("error" in tokenParsed) return { error: tokenParsed.error }
  const token = tokenParsed.token
  const sub: ExpenseSubmission = {
    sessionId, amount: parsed.data.amount, accountId: parsed.data.accountId,
    payee: parsed.data.payee, description: parsed.data.description,
    receiptRef: parsed.data.receiptRef, fundId: parsed.data.fundId,
  }
  const replayDone = makeReplayDone(sessionId)
  /** Returns `error`, unless a concurrent twin committed this very expense meanwhile — then redirects. */
  const orReplay = makeOrReplay(token, () => expenseTokenState(prisma, token!, sub), replayDone)
  // Replay check runs first — before the session-closed / period-lock guards and
  // the duplicate and negative-float warnings: a lost-response retry after the
  // session closed or the period locked must still land on the session page, and
  // the earlier attempt's own row (and its balance hit) would otherwise trip them.
  if (token) {
    const { state } = await expenseTokenState(prisma, token, sub)
    if (state === "replay") return replayDone()
    if (state === "reused") return { error: SUBMISSION_TOKEN_REUSED_ERROR }
  }
  const loaded = await loadOpenExpenseSession(sessionId)
  // Guard errors re-check the token (orReplay): a twin may have committed and the
  // session closed / period locked since the first lookup (#563).
  if (loaded.error !== undefined) return orReplay({ error: loaded.error })
  const { existing, sessionDate } = loaded
  const account = await validateAccount(parsed.data.accountId, "EXPENSE")
  if (!account) return { error: "Invalid account" }
  if (parsed.data.fundId != null && !(await validateFund(parsed.data.fundId)))
    return { error: "Invalid fund" }

  // Likely-duplicate guard: a manually-keyed petty-cash expense has no
  // unique constraint guarding against a re-keyed or double-submitted entry —
  // same class of bug closed for the direct transaction route. Warn
  // (don't hard-block) on an existing expense in the SAME session matching
  // date + amount + payee + description. The form resubmits with
  // confirmDuplicate to post it anyway. `&&` short-circuits so the lookup
  // never runs once the user has already confirmed.
  // A concurrent twin of this very submit may have committed the row that trips
  // a warning below — orReplay re-checks the token so the twin redirects instead.
  if (!parsed.data.confirmDuplicate && (await isDuplicateExpense(sessionId, sessionDate, parsed.data))) {
    return orReplay({
      error: "Possible duplicate: an expense with the same date, amount, payee, and description already exists in this session. Submit again to post it anyway.",
      duplicateWarning: true,
    })
  }

  // Negative-float guard: unlike transfers, expense creation had no
  // running-balance check, so a re-keyed/erroneous expense could drive the
  // session float negative — which then silently blocks all future transfers
  // and inflates EXPENSE in the P&L mirror. Real cash can't go negative, so
  // this is always a data-entry error worth surfacing. Warn, don't hard-block
  // (mirrors the duplicate-warning UX): the "Record anyway" resubmit sets
  // confirmNegative. The balance is a pre-insert read here (not inside the
  // insert tx) — a soft warning, not the hard concurrency guard transfers need.
  // Computed unconditionally (pure arithmetic over already-fetched rows, no I/O)
  // so the confirmNegative check below can be a single condition.
  const balance = calcRunningBalance(
    existing.openingBalance,
    existing.receipts,
    existing.expenses,
    existing.transfers
  )
  if (!parsed.data.confirmNegative && toCents(parsed.data.amount) > toCents(balance)) {
    return orReplay({
      error: negativeFloatWarning(parsed.data.amount, balance),
      negativeBalanceWarning: true,
    })
  }

  // Resolved once, not per row — mirrors the xferAccountId pattern in
  // pettyCashTransfer.ts.
  const cashAccount = await getCashAccount()

  try {
    // Account re-check + write + audit share one Serializable transaction so a
    // concurrent retype can't land between them, and the entry can never commit
    // without its "created" audit row (so a replay never needs to backfill one, #563).
    const result = await serializableWrite<{ error: string } | { id: number } | { replay: true }>(async (tx) => {
      // Lock order: shared accounting advisory lock first, before any row lock or session-row write, so this
      // write and setAccountingLockDate (exclusive) never wait on each other in a cycle (AUD-3-08).
      await holdAccountingLock(tx, "shared")
      // Token re-check inside the tx: a twin submit may have committed since the
      // pre-check (serializableWrite's P2034 retry lands here and sees it).
      if (token) {
        const { state } = await expenseTokenState(tx, token, sub)
        if (state === "replay") return { replay: true }
        if (state === "reused") return { error: SUBMISSION_TOKEN_REUSED_ERROR }
      }
      // Re-assert OPEN inside the tx — a concurrent close between the check
      // above and this write must not post into a closed session.
      await assertSessionOpenTx(tx, sessionId)
      // Period-lock re-check inside the write (AUD-3-08): a lock set after the pre-check must still block it.
      const txLockError = await assertUnlockedTx(tx, sessionDate)
      if (txLockError) return { error: txLockError }
      const fresh = await accountMatches(tx, parsed.data.accountId, "EXPENSE")
      if (!fresh) return { error: "Invalid account" }
      const id = await createExpenseEntry(tx, {
        sessionId, date: sessionDate, accountId: parsed.data.accountId, accountName: fresh.name,
        amount: parsed.data.amount, payee: parsed.data.payee, description: parsed.data.description,
        receiptRef: parsed.data.receiptRef, sessionTitle: existing.title, fundId: parsed.data.fundId,
        cashAccountId: cashAccount?.id ?? null, submissionToken: token,
      })
      await logPettyCashEntryAuditTx(tx, actorId(session), "Expense", "CREATED", id, parsed.data, sessionId)
      return { id }
    }, PETTY_CASH_BUSY, PETTY_CASH_GONE)
    if ("replay" in result) return replayDone()
    if ("error" in result) return result
  } catch (e) {
    return resolveCreateWriteError(e, "createExpense", token, () => expenseTokenState(prisma, token!, sub), replayDone)
  }
  revalidatePettyCashPaths(sessionId)
  redirect(`/accounting/petty-cash/sessions/${sessionId}`)
}

/** Edit a petty cash expense. ADMIN/PASTOR only. */
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
  const off = await featureGuard("pettyCash")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const expense = await prisma.pettyCashExpense.findUnique({
    where: { id },
    include: {
      session: { select: { id: true, status: true, title: true } },
      transaction: { select: { id: true, reconciled: true } },
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
  // allowInactive: editing a historical entry — an account or fund deactivated
  // after the fact must remain valid.
  const account = await validateAccount(parsed.data.accountId, "EXPENSE", { allowInactive: true })
  if (!account) return { error: "Invalid account" }
  if (parsed.data.fundId != null && !(await validateFund(parsed.data.fundId, { allowInactive: true })))
    return { error: "Invalid fund" }
  // Negative-float warning on edit (AUD-3-04), same soft-confirm UX as createExpense.
  // Cash available to this expense = running balance with its old amount added back.
  // Only an increase can newly overdraw, so a same-or-lower edit skips the read.
  if (!parsed.data.confirmNegative && toCents(parsed.data.amount) > toCents(expense.amount)) {
    const ledger = await prisma.pettyCashSession.findUnique({
      where: { id: expense.sessionId },
      select: {
        openingBalance: true,
        receipts: { select: { amount: true } },
        expenses: { select: { id: true, amount: true } },
        transfers: { select: { amount: true } },
      },
    })
    // Add back this expense's amount from the SAME snapshot as the balance: a concurrent
    // edit between the first read and this one must not mix two versions. Gone = deleted
    // concurrently; the write below fails on its own, so no warning.
    const ledgerExpense = ledger?.expenses.find((e) => e.id === id)
    if (ledger && ledgerExpense) {
      const availableCents =
        toCents(calcRunningBalance(ledger.openingBalance, ledger.receipts, ledger.expenses, ledger.transfers)) +
        toCents(ledgerExpense.amount)
      if (toCents(parsed.data.amount) > availableCents)
        return { error: negativeFloatWarning(parsed.data.amount, availableCents / 100), negativeBalanceWarning: true }
    }
  }
  // confirmDuplicate/confirmNegative are form-only flags — strip
  // them so they can't land in the Prisma update payload; PettyCashExpense has
  // no such column and the spread below would otherwise throw
  // PrismaClientValidationError on every edit.
  const { confirmDuplicate: _cd, confirmNegative: _cn, ...rest } = parsed.data
  // Resolved once, not per row — see createExpense above.
  const cashAccount = await getCashAccount()
  try {
    // Account re-check + write share one Serializable transaction (see createExpense).
    const result = await serializableWrite<{ error: string } | null>(async (tx) => {
      // Lock order: shared accounting advisory lock first, before any row lock or session-row write, so this
      // write and setAccountingLockDate (exclusive) never wait on each other in a cycle (AUD-3-08).
      await holdAccountingLock(tx, "shared")
      // Re-assert OPEN inside the tx — a concurrent close must not let an edit
      // land in a now-closed session.
      await assertSessionOpenTx(tx, expense.sessionId, "Cannot edit in closed session")
      // In-tx re-checks (AUD-3-08): a lock change or reconcile after the pre-checks must still block the edit.
      // The mirror row lock (FOR UPDATE) holds off a reconcile until this edit commits.
      const txLockError = await assertUnlockedTx(tx, sessionDate)
      if (txLockError) return { error: txLockError }
      await assertMirrorNotReconciledTx(tx, expense.transaction?.id, RECONCILED_EDIT_ERROR)
      const fresh = await accountMatches(tx, parsed.data.accountId, "EXPENSE", { allowInactive: true })
      if (!fresh) return { error: "Invalid account" }
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
    // reconciled: false — never rewrite a reconciled mirror; a mirror read above that now matches nothing rolls the edit back.
    const mirror = await tx.transaction.updateMany({
      where: { pettyCashExpenseId: id, reconciled: false },
      data: {
        date: sessionDate,
        amount: parsed.data.amount,
        accountId: parsed.data.accountId,
        description: encrypt(fresh.name),
        // Re-assert invariants on the mirror so an edit can't drift it off a
        // petty-cash EXPENSE row.
        type: "EXPENSE",
        paymentAccountId: cashAccount?.id ?? null,
        fundId: parsed.data.fundId,
      },
    })
    if (expense.transaction && mirror.count === 0) throw new SessionClosedError(RECONCILED_EDIT_ERROR)
    await logPettyCashEntryAuditTx(tx, actorId(session), "Expense", "UPDATED", id, parsed.data, expense.sessionId)
    return null
    }, PETTY_CASH_BUSY, PETTY_CASH_GONE)
    if (result) return result
  } catch (e) {
    if (e instanceof SessionClosedError) return { error: e.message }
    if (e instanceof AuditWriteError) return auditFailed(e, "updateExpense")
    throw e
  }
  revalidatePettyCashPaths(expense.sessionId)
  redirect(`/accounting/petty-cash/sessions/${expense.sessionId}`)
}

/** Delete a petty cash expense. ADMIN only. */
export async function deleteExpense(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("pettyCash")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const expense = await prisma.pettyCashExpense.findUnique({
    where: { id },
    include: { session: { select: { id: true, status: true, title: true } }, transaction: { select: { id: true, reconciled: true } } },
  })
  if (!expense) return { error: "Expense not found" }
  if (expense.session.status === "CLOSED") return { error: "Cannot delete from closed session" }
  if (expense.transaction?.reconciled) return { error: RECONCILED_DELETE_ERROR }
  // Fail closed: an unparseable title must not skip the period-lock check.
  const expenseSessionDate = sessionDateFromTitle(expense.session.title)
  if (!expenseSessionDate) return { error: "Invalid session date" }
  const lockError = await assertUnlocked(expenseSessionDate)
  if (lockError) return { error: lockError }
  // ATO retention: same fixed 7-year floor as deleteTransaction —
  // independent of the admin-configurable period lock above.
  if (expense.date >= retentionFloor()) return { error: retentionError(expense.date) }
  const userId = actorId(session)
  // Re-assert OPEN + not-reconciled inside the delete transaction — see
  // deleteReceipt; closes the concurrent close/reconcile race left open by.
  try {
    await prisma.$transaction(async (tx) => {
      // Lock order: shared accounting advisory lock first, before any row lock or session-row write, so this
      // write and setAccountingLockDate (exclusive) never wait on each other in a cycle (AUD-3-08).
      await holdAccountingLock(tx, "shared")
      await assertSessionOpenTx(tx, expense.session.id, "Cannot delete from closed session")
      // Period-lock re-check inside the delete (AUD-3-08): a lock set after the pre-check must still block it.
      const txLockError = await assertUnlockedTx(tx, expenseSessionDate)
      if (txLockError) throw new SessionClosedError(txLockError)
      // Audit metadata comes from the row as read INSIDE the tx (not the pre-read), so a
      // concurrent edit between the two can't leave the DELETED row describing stale values.
      const row = await tx.pettyCashExpense.findUnique({
        where: { id },
        select: { amount: true, accountId: true, sessionId: true, transaction: { select: { id: true, reconciled: true } } },
      })
      if (!row) throw new SessionClosedError("Expense not found")
      // Locked re-check: a reconcile must not commit between this check and the cascade delete.
      await assertMirrorNotReconciledTx(tx, row.transaction?.id)
      await tx.pettyCashExpense.delete({ where: { id } })
      await logPettyCashEntryDeletedAuditTx(tx, userId, "Expense", id, row)
    })
  } catch (e) {
    if (e instanceof SessionClosedError) return { error: e.message }
    if (e instanceof AuditWriteError) return auditFailed(e, "deleteExpense")
    // Plain (non-retrying) tx: a write conflict/deadlock (P2034, which logAuditGuardedTx
    // passes through for serializableWrite) is a "try again", not a 500.
    if (isP2034(e)) return PETTY_CASH_BUSY
    throw e
  }
  revalidatePettyCashPaths(expense.sessionId)
}
