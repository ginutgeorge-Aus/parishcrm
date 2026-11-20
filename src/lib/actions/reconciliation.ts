"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { AuditWriteError, auditWriteFailedResult, logAuditGuardedTx } from "@/lib/auditGuard"
import { logger } from "@/lib/logger"
import { endOfDayUTC } from "@/lib/dates"
import { toCents, centsToNumber, fmtAUD } from "@/lib/formatting"
import { TransactionType } from "@/lib/generated/prisma/enums"
import { Prisma } from "@/lib/generated/prisma/client"
import { assertUnlocked, getAccountingLockDate } from "@/lib/accountingLock"
import { SIGNED_MONEY_DECIMAL_RE, MIN_YEAR, MAX_YEAR, isP2034 } from "@/lib/validation"

import type { ActionResultWithSuccess } from "./types"
import { featureGuard } from "@/lib/featureFlags"

const MAX_TX_ATTEMPTS = 3

const Schema = z.object({
  paymentAccountId: z.coerce.number().int().positive(),
  statementDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid date")
    // Cap to plausible years so a far-future date can't reconcile the whole
    // forward ledger in one save — mirrors the bound the old bulkReconcile had.
    .refine(
      (v) => new Date(v) >= new Date(`${MIN_YEAR}-01-01`) && new Date(v) <= new Date(`${MAX_YEAR}-12-31`),
      "Date out of bounds"
    ),
  closingBalance: z
    .string()
    .max(15)
    // Negative allowed — an overdrawn account still gets reconciled.
    .regex(SIGNED_MONEY_DECIMAL_RE, "Amount must be a valid number")
    .refine((v) => Math.abs(Number.parseFloat(v)) <= 99_999_999.99, "Amount too large"),
})

/** Save a bank statement balance for reconciliation. ADMIN/PASTOR only. */
export async function saveStatementBalance(
  paymentAccountId: number,
  statementDate: string,
  closingBalance: string
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("reconciliation")
  if (off) return off

  const parsed = Schema.safeParse({ paymentAccountId, statementDate, closingBalance })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Client-supplied FK (#security checklist): confirm the account exists
  // before doing anything else with it.
  const account = await prisma.paymentAccount.findUnique({ where: { id: parsed.data.paymentAccountId } })
  if (!account) return { error: "Account not found" }

  const date = new Date(parsed.data.statementDate)
  const lockError = await assertUnlocked(date)
  if (lockError) return { error: lockError }

  // Pass the validated string straight to the Decimal column — parseFloat
  // would round-trip through binary float.
  const amount = parsed.data.closingBalance
  const userId = actorId(session)

  // Upsert the statement AND decide-and-write the reconcile in one interactive
  // Serializable transaction: under READ COMMITTED a concurrent
  // insert between the balance read and the updateMany could silently reconcile a
  // transaction that unbalances the books, and a crash between the upsert and the
  // reconcile could leave the statement saved but the period unreconciled. One
  // atomic unit closes both windows; a concurrent insert aborts with P2034 and we
  // retry, recomputing the decision against the new row.
  let outcome: { result: ActionResultWithSuccess }
  try {
    outcome = await finalizeReconciliation(parsed.data.paymentAccountId, date, amount, userId)
  } catch (e) {
    if (e instanceof AuditWriteError) return auditWriteFailedResult(e, "saveStatementBalance")
    // this was silently swallowed with no logging — a real DB failure
    // was indistinguishable from any other cause.
    logger.error("saveStatementBalance failed", {
      error: e instanceof Error ? e.message : String(e),
      paymentAccountId: parsed.data.paymentAccountId,
      statementDate: parsed.data.statementDate,
    })
    return { error: "Failed to save" }
  }

  // reconcileIfBalanced may mark transactions reconciled, changing dashboard
  // balances — revalidate /accounting too, matching the petty-cash/transaction
  // mutation pattern.
  revalidatePath("/accounting")
  revalidatePath("/accounting/reconciliation")
  revalidatePath("/accounting/transactions")
  return outcome.result
}

/**
 * Runs the statement upsert + reconcile-on-save inside one Serializable
 * transaction, retrying the whole unit on a serialization conflict (P2034).
 */
async function finalizeReconciliation(
  paymentAccountId: number,
  statementDate: Date,
  closingBalance: string,
  userId: number | null
): Promise<{ result: ActionResultWithSuccess }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const record = await tx.reconciliationStatement.upsert({
            where: {
              paymentAccountId_statementDate: { paymentAccountId, statementDate },
            },
            create: { paymentAccountId, statementDate, closingBalance },
            update: { closingBalance },
          })
          // Reconcile-on-save: saving a closing balance that matches the book
          // balance is what marks the period's transactions reconciled. Without an
          // opening balance there is no book balance to check against, so we just
          // record the statement.
          const recon = await reconcileIfBalanced(tx, paymentAccountId, statementDate, closingBalance)
          // Audit rows join the Serializable tx so a failed audit rolls back the save/reconcile.
          // Trade-off: a P2034 retry re-runs the whole callback, so these inserts repeat per
          // attempt (the earlier attempt's rows rolled back, so no duplicates land) — bounded
          // by MAX_TX_ATTEMPTS and cheaper than a window where the save commits unaudited.
          await logAuditGuardedTx(tx, userId, "RECON_STATEMENT_SAVED", "ReconciliationStatement", record.id, {
            paymentAccountId,
            statementDate: statementDate.toISOString().slice(0, 10),
          })
          if (recon.reconciledCount !== null) {
            await logAuditGuardedTx(tx, userId, "RECON_AUTO_RECONCILED", "ReconciliationStatement", undefined, {
              paymentAccountId,
              count: recon.reconciledCount,
              closingBalance,
              lockApplied: recon.lockApplied ?? null,
            })
          }
          return { result: recon.result }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    } catch (e) {
      // A concurrent insert into the reconciled range made the balance decision
      // stale; retry so the recomputed decision reflects the new row.
      if (isP2034(e) && attempt < MAX_TX_ATTEMPTS) continue
      throw e
    }
  }
}

/**
 * Book balance over (opening.asOfDate .. statementDate] = opening + all income −
 * all expenses, counting every transaction regardless of its reconciled flag.
 * If that equals the just-saved closing balance, the books match the bank, so
 * the whole period is marked reconciled. Bounds mirror the reconciliation page's
 * equation exactly so the on-screen Difference and this decision never disagree.
 * Runs on the caller's transaction client (`tx`) so the read and the updateMany
 * are one atomic Serializable unit. Returns the reconciled count (or
 * null when nothing was reconciled) for the caller to audit inside the same transaction.
 */
async function reconcileIfBalanced(
  tx: Prisma.TransactionClient,
  paymentAccountId: number,
  statementDate: Date,
  closingBalance: string
): Promise<{ result: ActionResultWithSuccess; reconciledCount: number | null; lockApplied?: string | null }> {
  const opening = await tx.accountOpeningBalance.findUnique({
    where: { paymentAccountId },
  })
  if (!opening) return { result: { success: "Saved" }, reconciledCount: null }

  const lte = endOfDayUTC(statementDate)
  // Statement predates the opening balance: nothing in range to reconcile, and a
  // book balance over an inverted range is meaningless. Record the statement only.
  if (lte < opening.asOfDate) return { result: { success: "Saved" }, reconciledCount: null }

  // Read the lock date via `tx` (not the outer prisma singleton used by the
  // assertUnlocked pre-check in saveStatementBalance) so a concurrent lock-date
  // change can't race between that pre-check and this commit. The lock only
  // narrows which rows get marked reconciled (below); the book-balance
  // equation still spans the full range so it matches the reconciliation page.
  const lockDate = await getAccountingLockDate(tx)
  const lockEnd = lockDate ? endOfDayUTC(lockDate) : null
  // A lock change between the saveStatementBalance pre-check and this commit can
  // put the statement date itself in a locked period. Nothing is reconcilable then.
  if (lockDate && lockEnd !== null && lockEnd >= lte) {
    return {
      result: {
        success: `Saved. The statement date falls in a locked accounting period (on or before ${lockDate.toISOString().slice(0, 10)}) — transactions not reconciled.`,
      },
      reconciledCount: null,
    }
  }

  const range = { gte: opening.asOfDate, lte }
  // Sequential awaits, not Promise.all — an interactive transaction runs on one
  // connection and rejects concurrent queries.
  const income = await tx.transaction.aggregate({
    where: { paymentAccountId, type: TransactionType.INCOME, date: range },
    _sum: { amount: true },
  })
  const expense = await tx.transaction.aggregate({
    where: { paymentAccountId, type: TransactionType.EXPENSE, date: range },
    _sum: { amount: true },
  })

  // Compare in exact integer cents — the inputs are Decimal(10,2), so summing
  // via Number() would accumulate IEEE-754 drift the codebase avoids elsewhere
  // (matches the toCents convention).
  const bookCents =
    toCents(opening.amount) + toCents(income._sum.amount) - toCents(expense._sum.amount)
  const diffCents = Math.abs(bookCents - toCents(closingBalance))
  if (diffCents >= 1) {
    return {
      result: {
        success: `Saved. Book balance ${fmtAUD(centsToNumber(bookCents))} does not match the statement — out by ${fmtAUD(centsToNumber(diffCents))}; transactions not reconciled.`,
      },
      reconciledCount: null,
    }
  }

  // Only rows strictly after the lock day may be marked reconciled. Locked rows
  // are read-only (even the reconciled flag: toggleReconciled/reconcileMany
  // reject them), so they stay as they are and we report how many were skipped.
  // No lock, or a lock before the range starts → the whole range (keeps `gte`
  // so rows stamped exactly at the opening date count).
  const lockInRange = lockEnd !== null && lockEnd >= opening.asOfDate
  const markRange = lockInRange ? { gt: lockEnd, lte } : range
  const updated = await tx.transaction.updateMany({
    where: { paymentAccountId, reconciled: false, date: markRange },
    data: { reconciled: true },
  })
  const skipped =
    lockInRange && lockDate
      ? await tx.transaction.count({
          where: { paymentAccountId, reconciled: false, date: { gte: opening.asOfDate, lte: lockEnd } },
        })
      : 0
  const lockNote =
    lockDate && skipped > 0
      ? ` (${skipped} unreconciled transaction${skipped === 1 ? "" : "s"} on or before ${lockDate.toISOString().slice(0, 10)} left unchanged — locked period)`
      : ""
  return {
    result: {
      success: `Balanced — ${updated.count} transaction${updated.count === 1 ? "" : "s"} reconciled.${lockNote}`,
    },
    reconciledCount: updated.count,
    lockApplied: lockInRange ? lockDate!.toISOString().slice(0, 10) : null,
  }
}
