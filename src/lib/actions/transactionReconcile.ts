"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { assertUnlocked } from "@/lib/accountingLock"
import type { ActionResult, ActionResultWithSuccess } from "./types"

export async function toggleReconciled(
  id: number,
  expectedPaymentAccountId: number
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }

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
  await prisma.transaction.update({
    where: { id },
    data: { reconciled: next },
  })
  await logAudit(actorId(session), "TRANSACTION_RECONCILED", "Transaction", id, {
    reconciled: next,
    paymentAccountId: existing.paymentAccountId,
  })
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
  if (toReconcile.length > 0) {
    await prisma.transaction.updateMany({
      where: { id: { in: toReconcile } },
      data: { reconciled: true },
    })
  }
  await logAudit(actorId(session), "TRANSACTION_RECONCILED", "Transaction", undefined, {
    reconciled: true,
    paymentAccountId: expectedPaymentAccountId,
    count: toReconcile.length,
  })
  // No revalidateReports() here: the pl/balance-sheet/budget-vs-actual/
  // funds reports aggregate ALL transactions since asOfDate regardless of the
  // `reconciled` flag (book balance) — flipping reconciled never changes
  // their figures. Matches toggleReconciled and saveStatementBalance's
  // non-reconciling path, neither of which call it either.
  revalidatePath("/accounting")
  revalidatePath("/accounting/transactions")
  revalidatePath("/accounting/reconciliation")
  return {
    success: `${toReconcile.length} transaction${toReconcile.length === 1 ? "" : "s"} reconciled.`,
  }
}
