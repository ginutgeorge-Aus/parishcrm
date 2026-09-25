"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, isAdmin } from "@/lib/roleGuard"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { assertUnlocked } from "@/lib/accountingLock"
import { parseOptimisticUpdatedAt, hasEncryptedFieldMatch } from "@/lib/validation"
import { retentionFloor, retentionError } from "@/lib/retention"
import { validateFund } from "./fund"
import { TransactionSchema, validateParties } from "./transactionValidation"
import type { ActionResult } from "./types"

// Report pages cache transaction-derived figures, so every transaction
// mutation must invalidate them too — not just the list/index paths.
const ACCOUNTING_REPORT_PATHS = [
  "/accounting/reports/pl",
  "/accounting/reports/balance-sheet",
  "/accounting/reports/budget-vs-actual",
  "/accounting/reports/funds",
]
function revalidateReports() {
  for (const p of ACCOUNTING_REPORT_PATHS) revalidatePath(p)
}

// Likely-duplicate candidate scan is bounded to a small number of rows —
// legitimate matches on date+amount+account+paymentAccount+family should never
// number more than a handful, so this just bounds the safeDecrypt loop against
// a pathological number of coincidental matches.
const DUPLICATE_CANDIDATE_CAP = 20

// Shared with pettyCash.ts (receipt/expense account validation) — returns the
// account's name (needed for entry records there) on success, or null if the
// account doesn't exist, is inactive, or doesn't match the expected type.
export async function validateAccount(
  accountId: number,
  type: "INCOME" | "EXPENSE",
  options?: { allowInactive?: boolean }
): Promise<{ name: string } | null> {
  // Exported from a "use server" module ⇒ a directly callable server action, so
  // gate it like every other read helper (invariant). All internal callers
  // (createTransaction/updateTransaction, petty-cash receipt/expense) are already
  // canAccessAccounting-gated, so this only blocks direct unauthenticated calls.
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return null

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { type: true, isActive: true, name: true },
  })
  if (!account || account.type !== type) return null
  if (!options?.allowInactive && !account.isActive) return null
  return { name: account.name }
}

// Manual transaction create/edit may only post against a BANK-kind payment
// account — CASH-kind (petty cash) ledger rows are created only by the
// petty-cash actions, which are mirrored/FK-linked to a PettyCashSession; a
// manual entry against the cash account would be invisible to any session yet
// counted in petty-cash report aggregates.
async function validatePaymentAccount(
  paymentAccountId: number,
  options?: { allowInactive?: boolean }
): Promise<boolean> {
  const account = await prisma.paymentAccount.findUnique({
    where: { id: paymentAccountId },
    select: { kind: true, isActive: true },
  })
  if (!account || account.kind !== "BANK") return false
  if (!options?.allowInactive && !account.isActive) return false
  return true
}

export async function createTransaction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = TransactionSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const lockError = await assertUnlocked(parsed.data.date)
  if (lockError) return { error: lockError }

  if (!(await validateAccount(parsed.data.accountId, parsed.data.type)))
    return { error: "Invalid category" }

  if (!(await validatePaymentAccount(parsed.data.paymentAccountId)))
    return { error: "Invalid payment account" }

  if (parsed.data.fundId != null && !(await validateFund(parsed.data.fundId)))
    return { error: "Invalid fund" }

  // reconciled is stripped out of `rest` — a manual create/edit must
  // never flip it. Reconciling only happens via the dedicated toggleReconciled/
  // reconcileMany paths, which enforce the ownership + balance-guard checks and
  // emit TRANSACTION_RECONCILED, neither of which this form-driven write does.
  const { familyId, personId, confirmDuplicate, reconciled: _reconciled, ...rest } = parsed.data
  const partyError = await validateParties(familyId, personId)
  if (partyError) return { error: partyError }

  // Likely-duplicate guard: bank imports are protected by the unique
  // `bankRef`, but a manually-keyed transaction has no such guard — re-keying
  // the same Sunday offering or double-submitting an expense silently doubles
  // the ledger. Warn (don't hard-block) on an existing row matching date +
  // amount + account + payment account + family + description; the form
  // resubmits with confirmDuplicate to post it anyway.
  //
  // paymentAccount and familyId are included so a same-day,
  // same-amount entry to a *different* bank account (e.g. ANZ_CHURCH vs
  // ANZ_TITHE) or from a *different* family no longer false-warns just
  // because the category and description happen to coincide.
  if (!confirmDuplicate) {
    const candidates = (await prisma.transaction.findMany({
      where: {
        date: rest.date,
        amount: rest.amount,
        accountId: rest.accountId,
        paymentAccountId: rest.paymentAccountId,
        familyId,
      },
      select: { description: true },
      take: DUPLICATE_CANDIDATE_CAP,
    })) ?? []
    // safeDecrypt (not decrypt) — a corrupt/unrotated-key candidate row must
    // not throw and block this create; it just fails to match.
    const isDuplicate = hasEncryptedFieldMatch(candidates, [["description", rest.description]], safeDecrypt)
    if (isDuplicate) {
      return {
        error: "Possible duplicate: a transaction with the same date, amount, category, and description already exists. Submit again to post it anyway.",
        duplicateWarning: true,
      }
    }
  }

  const isGiving = !!familyId
  const created = await prisma.transaction.create({
    data: {
      ...rest,
      description: encrypt(rest.description),
      // notes can carry PII free-text — encrypt at rest. `...rest` spread
      // it in plaintext above; this override re-keys it. Read paths use safeDecrypt.
      notes: rest.notes ? encrypt(rest.notes) : null,
      isGiving,
      familyId,
      personId,
    },
  })
  await logAudit(actorId(session), "TRANSACTION_CREATED", "Transaction", created.id, {
    amount: Number(parsed.data.amount),
    type: parsed.data.type,
    accountId: parsed.data.accountId,
  })
  revalidatePath("/accounting")
  revalidatePath("/accounting/transactions")
  revalidateReports()
  redirect("/accounting/transactions")
}

export async function updateTransaction(
  id: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }

  const existing = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, date: true, reconciled: true, pettyCashReceiptId: true, pettyCashExpenseId: true, pettyCashTransferId: true },
  })
  if (!existing) return { error: "Not found" }
  if (existing.pettyCashReceiptId != null || existing.pettyCashExpenseId != null || existing.pettyCashTransferId != null)
    return { error: "Petty cash transactions cannot be edited here — edit via the petty cash session" }
  // Editing a reconciled row would silently un-balance a period that was marked
  // reconciled while leaving every row still flagged reconciled. Force a
  // deliberate re-open via the reconciliation page's un-reconcile toggle first.
  if (existing.reconciled)
    return { error: "This transaction is reconciled. Un-reconcile it on the Reconciliation page before editing." }

  const lockError = await assertUnlocked(existing.date)
  if (lockError) return { error: lockError }

  const parsed = TransactionSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Lock-check the SUBMITTED date too, not only the stored one: otherwise
  // a txn currently in an unlocked period can be re-dated into a locked period,
  // silently mutating already-closed books.
  const newDateLockError = await assertUnlocked(parsed.data.date)
  if (newDateLockError) return { error: newDateLockError }

  // allowInactive: this is an edit of a possibly-historical row — an account
  // deactivated after the fact must remain valid so the row stays editable and
  // keeps its original category, mirroring the fund guard below.
  if (!(await validateAccount(parsed.data.accountId, parsed.data.type, { allowInactive: true })))
    return { error: "Invalid category" }

  // allowInactive: this is an edit of a possibly-historical row — a payment
  // account deactivated after the fact must remain valid so the row stays
  // editable and keeps its original account (mirrors the category guard above).
  if (!(await validatePaymentAccount(parsed.data.paymentAccountId, { allowInactive: true })))
    return { error: "Invalid payment account" }

  // allowInactive: this is an edit of a possibly-historical row — a fund
  // deactivated after the fact must remain valid.
  if (parsed.data.fundId != null && !(await validateFund(parsed.data.fundId, { allowInactive: true })))
    return { error: "Invalid fund" }

  // confirmDuplicate is a form-only flag, not a Transaction column — exclude it
  // from `rest` or it gets spread into the Prisma update and rejects it.
  // reconciled is also stripped — the edit form's "Reconciled" checkbox
  // must not be able to flip it via this path (see createTransaction above);
  // the row is guaranteed unreconciled here anyway (blocked above if reconciled).
  const { familyId, personId, confirmDuplicate: _confirmDuplicate, reconciled: _reconciled, ...rest } = parsed.data
  const partyError = await validateParties(familyId, personId)
  if (partyError) return { error: partyError }
  const isGiving = !!familyId

  // Optimistic concurrency: the edit form submits the row's last-seen
  // updatedAt. Guard the write on it so two admins editing the same transaction
  // can't silently clobber each other — the second save matches 0 rows and is
  // told to reload. A missing/invalid token falls back to an id-only update
  // (older cached form) — no worse than the prior last-write-wins behaviour.
  const seenAt = parseOptimisticUpdatedAt(formData)
  const result = await prisma.transaction.updateMany({
    where: seenAt ? { id, updatedAt: seenAt } : { id },
    data: {
      ...rest,
      description: encrypt(rest.description),
      // notes can carry PII free-text — encrypt at rest. `...rest` spread
      // it in plaintext above; this override re-keys it. Read paths use safeDecrypt.
      notes: rest.notes ? encrypt(rest.notes) : null,
      isGiving,
      familyId,
      personId,
    },
  })
  if (result.count === 0) {
    return {
      error: "This transaction was changed by someone else since you opened it. Reload the page and reapply your edit.",
    }
  }
  await logAudit(actorId(session), "TRANSACTION_UPDATED", "Transaction", id, {
    amount: Number(parsed.data.amount),
    type: parsed.data.type,
    accountId: parsed.data.accountId,
  })
  revalidatePath("/accounting")
  revalidatePath("/accounting/transactions")
  revalidateReports()
  redirect("/accounting/transactions")
}

export async function deleteTransaction(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const existing = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, date: true, reconciled: true, pettyCashReceiptId: true, pettyCashExpenseId: true, pettyCashTransferId: true, amount: true, type: true, accountId: true },
  })
  if (!existing) return { error: "Not found" }
  if (existing.pettyCashReceiptId != null || existing.pettyCashExpenseId != null || existing.pettyCashTransferId != null)
    return { error: "Petty cash transactions cannot be deleted here — delete via the petty cash session" }
  // Deleting a reconciled row silently un-balances a reconciled period —
  // require a deliberate un-reconcile on the Reconciliation page first.
  if (existing.reconciled)
    return { error: "This transaction is reconciled. Un-reconcile it on the Reconciliation page before deleting." }

  const lockError = await assertUnlocked(existing.date)
  if (lockError) return { error: lockError }

  if (existing.date >= retentionFloor()) return { error: retentionError(existing.date) }

  await prisma.transaction.delete({ where: { id } })
  await logAudit(actorId(session), "TRANSACTION_DELETED", "Transaction", id, {
    amount: Number(existing.amount),
    type: existing.type,
    accountId: existing.accountId,
  })
  revalidatePath("/accounting")
  revalidatePath("/accounting/transactions")
  revalidateReports()
}
