"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { endOfDayUTC } from "@/lib/dates"
import { toCents, centsToNumber, fmtAUD } from "@/lib/formatting"
import { TransactionType } from "@/lib/generated/prisma/enums"
import { Prisma } from "@/lib/generated/prisma/client"
import { assertUnlocked, ACCOUNTING_LOCK_DATE_KEY, isDateLocked } from "@/lib/accountingLock"
import { SIGNED_MONEY_DECIMAL_RE, MIN_YEAR, MAX_YEAR } from "@/lib/validation"

import type { ActionResultWithSuccess } from "./types"

// Prisma maps Postgres serialization failures on a Serializable txn to P2034.
function isSerializationConflict(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: unknown }).code === "P2034"
}
const MAX_TX_ATTEMPTS = 3

const Schema = z.object({
  paymentAccountId: z.coerce.number().int().positive(),
  statementDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .refine((v) => !isNaN(new Date(v).getTime()), "Invalid date")
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
    .refine((v) => Math.abs(parseFloat(v)) <= 99_999_999.99, "Amount too large"),
})

export async function saveStatementBalance(
  paymentAccountId: number,
  statementDate: string,
  closingBalance: string
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }

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
  let outcome: { result: ActionResultWithSuccess; recordId: number; reconciledCount: number | null }
  try {
    outcome = await finalizeReconciliation(parsed.data.paymentAccountId, date, amount)
  } catch (e) {
    // this was silently swallowed with no logging — a real DB failure
    // was indistinguishable from any other cause.
    logger.error("saveStatementBalance failed", {
      error: e instanceof Error ? e.message : String(e),
      paymentAccountId: parsed.data.paymentAccountId,
      statementDate: parsed.data.statementDate,
    })
    return { error: "Failed to save" }
  }

  // Audit writes happen AFTER commit — never hold the interactive transaction open
  // across the audit-log inserts.
  await logAudit(userId, "RECON_STATEMENT_SAVED", "ReconciliationStatement", outcome.recordId, {
    paymentAccountId: parsed.data.paymentAccountId,
    statementDate: parsed.data.statementDate,
  })
  if (outcome.reconciledCount !== null) {
    await logAudit(userId, "RECON_AUTO_RECONCILED", "ReconciliationStatement", undefined, {
      paymentAccountId: parsed.data.paymentAccountId,
      count: outcome.reconciledCount,
      closingBalance: amount,
    })
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
  closingBalance: string
): Promise<{ result: ActionResultWithSuccess; recordId: number; reconciledCount: number | null }> {
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
          return { result: recon.result, recordId: record.id, reconciledCount: recon.reconciledCount }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    } catch (e) {
      // A concurrent insert into the reconciled range made the balance decision
      // stale; retry so the recomputed decision reflects the new row.
      if (isSerializationConflict(e) && attempt < MAX_TX_ATTEMPTS) continue
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
 * null when nothing was reconciled) for the caller to audit after commit.
 */
async function reconcileIfBalanced(
  tx: Prisma.TransactionClient,
  paymentAccountId: number,
  statementDate: Date,
  closingBalance: string
): Promise<{ result: ActionResultWithSuccess; reconciledCount: number | null }> {
  const opening = await tx.accountOpeningBalance.findUnique({
    where: { paymentAccountId },
  })
  if (!opening) return { result: { success: "Saved" }, reconciledCount: null }

  const lte = endOfDayUTC(statementDate)
  // Statement predates the opening balance: nothing in range to reconcile, and a
  // book balance over an inverted range is meaningless. Record the statement only.
  if (lte < opening.asOfDate) return { result: { success: "Saved" }, reconciledCount: null }

  // this reconcile is about to touch every unreconciled transaction from
  // opening.asOfDate through statementDate. saveStatementBalance only checked
  // statementDate itself — if the lock date falls anywhere in
  // [opening.asOfDate, statementDate], part of that range is a locked
  // accounting period, and marking those transactions reconciled would let a
  // later statement silently un-freeze them. opening.asOfDate is the earliest
  // date this reconcile would touch, so it alone determines whether the range
  // crosses the lock (the range's upper bound, statementDate, is already
  // guaranteed >= opening.asOfDate by the early return above). Read the lock
  // date via `tx` (not the outer prisma singleton assertUnlocked pre-check in
  // saveStatementBalance) so a concurrent lock-date change can't race between
  // that pre-check and this commit.
  const lockRow = await tx.appSetting.findUnique({ where: { key: ACCOUNTING_LOCK_DATE_KEY } })
  const lockDate = lockRow?.value ? new Date(lockRow.value) : null
  if (lockDate && !isNaN(lockDate.getTime()) && isDateLocked(opening.asOfDate, lockDate)) {
    return {
      result: {
        success: `Saved. Part of this reconciliation (from ${opening.asOfDate.toISOString().slice(0, 10)}) falls in a locked accounting period (on or before ${lockDate.toISOString().slice(0, 10)}) — transactions not reconciled.`,
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

  const updated = await tx.transaction.updateMany({
    where: { paymentAccountId, reconciled: false, date: range },
    data: { reconciled: true },
  })
  return {
    result: {
      success: `Balanced — ${updated.count} transaction${updated.count === 1 ? "" : "s"} reconciled.`,
    },
    reconciledCount: updated.count,
  }
}
