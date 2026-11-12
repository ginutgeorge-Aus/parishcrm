"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { AuditWriteError, auditWriteFailedResult, logAuditGuardedTx } from "@/lib/auditGuard"
import { isP2034 } from "@/lib/validation"
import { assertUnlocked } from "@/lib/accountingLock"
import type { ActionResult, ActionResultWithSuccess } from "./types"
import { featureGuard } from "@/lib/featureFlags"

/**
 * Maps a failed reconcile write transaction to an action result: a rolled-back audit
 * write gets the audit-specific message (logged server-side); a P2034 conflict on this
 * plain (non-retrying) tx is a "try again". Anything else returns null (caller rethrows).
 * @param e the caught error
 * @param label action name for the server log
 */
function mapReconcileWriteError(e: unknown, label: string): { error: string } | null {
  if (e instanceof AuditWriteError) return auditWriteFailedResult(e, label)
  if (isP2034(e)) return { error: "Conflict while saving — please try again." }
  return null
}

/** Flip a transaction's reconciled flag. ADMIN/PASTOR only. */
export async function toggleReconciled(
  id: number,
  expectedPaymentAccountId: number
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("reconciliation")
  if (off) return off

  const existing = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, date: true, reconciled: true, paymentAccountId: true },
  })
  if (!existing) return { error: "Not found" }
  // Ownership guard: the toggle is rendered per-account on the
  // reconciliation page. Reject a crafted id pointing at a different account so
  // it can't silently flip — and corrupt the equation of — an account the
  // caller isn't viewing. Same opaque "Not found" as a missing row.
  if (existing.paymentAccountId !== expectedPaymentAccountId) return { error: "Not found" }

  const lockError = await assertUnlocked(existing.date)
  if (lockError) return { error: lockError }

  const next = !existing.reconciled
  try {
    await prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id },
        data: { reconciled: next },
      })
      await logAuditGuardedTx(tx, actorId(session), "TRANSACTION_RECONCILED", "Transaction", id, {
        reconciled: next,
        paymentAccountId: existing.paymentAccountId,
      })
    })
  } catch (e) {
    const failed = mapReconcileWriteError(e, "toggleReconciled")
    if (failed) return failed
    throw e
  }
  revalidatePath("/accounting")
  revalidatePath("/accounting/transactions")
  revalidatePath("/accounting/reconciliation")
}

// Bound the selection to the reconciliation page's own row cap so a
// crafted payload can't ask to flip an unbounded set in one call.
const RECONCILE_MANY_MAX_IDS = 1000

const ReconcileManySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(RECONCILE_MANY_MAX_IDS),
})

/**
 * Mark a user-selected set of transactions reconciled in one action.
 * Unlike the removed "reconcile all" button, the caller picks specific
 * rows — this is the multi-row form of the per-row toggle, not a period finalize.
 */
export async function reconcileMany(
  ids: number[],
  expectedPaymentAccountId: number
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("reconciliation")
  if (off) return off

  const parsed = ReconcileManySchema.safeParse({ ids })
  if (!parsed.success) return { error: "Invalid selection" }
  const uniqueIds = Array.from(new Set(parsed.data.ids))

  const rows = await prisma.transaction.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, date: true, paymentAccountId: true, reconciled: true },
  })
  // Every selected row must exist and belong to the viewed account — a crafted
  // id pointing at another account (or a missing row) rejects the whole batch,
  // same opaque "Not found" as the single toggle.
  if (
    rows.length !== uniqueIds.length ||
    rows.some((r) => r.paymentAccountId !== expectedPaymentAccountId)
  ) {
    return { error: "Not found" }
  }

  // Locks cover dates on or before the lock date, so the earliest selected date
  // is locked iff any selected date is — guarding it rejects the whole batch.
  const minDate = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date)
  const lockError = await assertUnlocked(minDate)
  if (lockError) return { error: lockError }

  const toReconcile = rows.filter((r) => !r.reconciled).map((r) => r.id)
  // Nothing to flip: no write and no audit row (a no-op must not log an event).
  let reconciledCount = 0
  if (toReconcile.length > 0) {
    try {
      reconciledCount = await prisma.$transaction(async (tx) => {
        // `reconciled: false` guard + the returned count keep the audit row accurate
        // if a concurrent toggle flipped some of these rows after the read above.
        const res = await tx.transaction.updateMany({
          where: { id: { in: toReconcile }, reconciled: false },
          data: { reconciled: true },
        })
        // Skip the audit when a concurrent toggle already flipped every row.
        if (res.count > 0)
          await logAuditGuardedTx(tx, actorId(session), "TRANSACTION_RECONCILED", "Transaction", undefined, {
            reconciled: true,
            paymentAccountId: expectedPaymentAccountId,
            count: res.count,
          })
        return res.count
      })
    } catch (e) {
      const failed = mapReconcileWriteError(e, "reconcileMany")
      if (failed) return failed
      throw e
    }
  }
  // No revalidateReports() here: the pl/balance-sheet/budget-vs-actual/
  // funds reports aggregate ALL transactions since asOfDate regardless of the
  // `reconciled` flag (book balance) — flipping reconciled never changes
  // their figures. Matches toggleReconciled and saveStatementBalance's
  // non-reconciling path, neither of which call it either.
  revalidatePath("/accounting")
  revalidatePath("/accounting/transactions")
  revalidatePath("/accounting/reconciliation")
  return {
    success: `${reconciledCount} transaction${reconciledCount === 1 ? "" : "s"} reconciled.`,
  }
}
