"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma/client"
import { canAccessAccounting, isAdmin } from "@/lib/roleGuard"
import { calcRunningBalance } from "@/lib/pettyCashLedger"
import { toCents } from "@/lib/formatting"
import { encrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { assertUnlocked } from "@/lib/accountingLock"
import { retentionFloor, retentionError } from "@/lib/retention"
import { MONEY_DECIMAL_RE } from "@/lib/validation"
import { getXferAccountId } from "@/lib/xferAccount"
import { getCashAccount } from "@/lib/paymentAccounts"
import type { ActionResult } from "./types"
import { revalidatePettyCashPaths, RECONCILED_DELETE_ERROR, assertSessionOpenTx, SessionClosedError } from "./pettyCashEntry"

// Thrown inside the createTransfer Serializable transaction to surface a
// validation failure as a clean ActionResult error (caught just outside).
class TransferError extends Error {}

// --- Transfers ---

// Transfers keep a user-entered date (unlike receipts/expenses, which are forced
// to the session date) — a bank deposit can happen days after the session.
const TransferSchema = z.object({
  date: z
    .string()
    .min(1, "Date is required")
    .transform((v) => new Date(v))
    // Zod does not validate transform output — a malformed string yields an
    // Invalid Date (NaN) that Postgres rejects with an unhandled 500.
    .refine((d) => !Number.isNaN(d.getTime()), "Invalid date"),
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
  retainedFloat: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : "0"))
    .refine((v) => MONEY_DECIMAL_RE.test(v), "Retained float must be a non-negative amount"),
  depositSlipRef: z.string().max(100).optional().transform((v) => v || undefined),
  depositedByName: z.string().min(1, "Deposited by is required").max(200),
  notes: z.string().max(1000).optional().transform((v) => v || undefined),
})

export async function createTransfer(
  sessionId: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = TransferSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const transferLockError = await assertUnlocked(parsed.data.date)
  if (transferLockError) return { error: transferLockError }

  // Resolve the shared XFER account before the Serializable transaction — its
  // self-heal create would otherwise risk a serialization conflict.
  const xferAccountId = await getXferAccountId(prisma)
  // Resolved once, not per row — same reasoning as xferAccountId above.
  const cashAccount = await getCashAccount()

  // Read balance, validate and insert inside one Serializable transaction so two
  // concurrent transfers can't both pass the same balance check and together
  // overdraw the float — the second hits a serialization conflict.
  let transferId: number
  try {
    transferId = await prisma.$transaction(async (tx) => {
      const existing = await tx.pettyCashSession.findUnique({
        where: { id: sessionId },
        include: {
          receipts: { select: { amount: true } },
          expenses: { select: { amount: true } },
          transfers: { select: { amount: true } },
        },
      })
      if (!existing) throw new TransferError("Session not found")
      if (existing.status === "CLOSED") throw new TransferError("Session is closed")
      const balance = calcRunningBalance(
        existing.openingBalance,
        existing.receipts,
        existing.expenses,
        existing.transfers
      )
      if (toCents(parsed.data.amount) > toCents(balance))
        throw new TransferError(`Transfer amount exceeds balance of ${balance.toFixed(2)}`)
      const transfer = await tx.pettyCashTransfer.create({
        data: {
          sessionId,
          date: parsed.data.date,
          amount: parsed.data.amount,
          retainedFloat: parsed.data.retainedFloat,
          depositSlipRef: parsed.data.depositSlipRef,
          // depositedByName + notes are PII-bearing free text — encrypt at rest
          depositedByName: encrypt(parsed.data.depositedByName),
          notes: parsed.data.notes ? encrypt(parsed.data.notes) : null,
        },
      })
      // Mirror the transfer into the Transaction ledger (symmetric with
      // receipt/expense mirrors) so the dashboard PETTY_CASH balance
      // reflects session transfers and agrees with the session running balance
      //. Uses the shared XFER account, like the bank-import transfer leg.
      await tx.transaction.create({
        data: {
          date: transfer.date,
          amount: transfer.amount,
          type: "EXPENSE",
          accountId: xferAccountId,
          isGiving: false,
          paymentAccountId: cashAccount?.id ?? null,
          bankRef: `PC_T_${transfer.id}`,
          description: encrypt("Transfer to bank"),
          reference: existing.title,
          pettyCashTransferId: transfer.id,
        },
      })
      return transfer.id
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (e) {
    if (e instanceof TransferError) return { error: e.message }
    // P2034 = Serializable serialization failure: a concurrent transfer beat
    // this one. Surface a retry prompt rather than a 500.
    if (e && typeof e === "object" && "code" in e && e.code === "P2034")
      return { error: "Transfer conflict — please try again." }
    throw e
  }
  await logAudit(actorId(session), "PETTY_CASH_TRANSFER_CREATED", "PettyCashTransfer", transferId, {
    amount: parsed.data.amount,
    sessionId,
  })
  revalidatePettyCashPaths(sessionId)
  redirect(`/accounting/petty-cash/sessions/${sessionId}`)
}

export async function deleteTransfer(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const transfer = await prisma.pettyCashTransfer.findUnique({
    where: { id },
    include: { session: { select: { id: true, status: true } }, transaction: { select: { id: true, reconciled: true } } },
  })
  if (!transfer) return { error: "Transfer not found" }
  if (transfer.session.status === "CLOSED") return { error: "Cannot delete from closed session" }
  if (transfer.transaction?.reconciled) return { error: RECONCILED_DELETE_ERROR }
  const transferDeleteLockError = await assertUnlocked(transfer.date)
  if (transferDeleteLockError) return { error: transferDeleteLockError }
  // ATO retention: same fixed 7-year floor as deleteTransaction —
  // independent of the admin-configurable period lock above.
  if (transfer.date >= retentionFloor()) return { error: retentionError(transfer.date) }
  // Re-assert OPEN + not-reconciled inside the delete transaction — see
  // deleteReceipt; closes the concurrent close/reconcile race left open by.
  try {
    await prisma.$transaction(async (tx) => {
      await assertSessionOpenTx(tx, transfer.session.id, "Cannot delete from closed session")
      if (transfer.transaction) {
        const mirror = await tx.transaction.findUnique({ where: { id: transfer.transaction.id }, select: { reconciled: true } })
        if (mirror?.reconciled) throw new SessionClosedError(RECONCILED_DELETE_ERROR)
      }
      await tx.pettyCashTransfer.delete({ where: { id } })
    })
  } catch (e) {
    if (e instanceof SessionClosedError) return { error: e.message }
    throw e
  }
  const userId = actorId(session)
  await logAudit(userId, "PETTY_CASH_TRANSFER_DELETED", "PettyCashTransfer", id, {
    amount: Number(transfer.amount),
    sessionId: transfer.sessionId,
  })
  // The mirrored XFER ledger row is removed by FK cascade (Transaction
  // .pettyCashTransferId onDelete: Cascade) — log it explicitly so the
  // Transaction audit trail doesn't show a ghost deletion (matches deleteReceipt).
  if (transfer.transaction)
    await logAudit(userId, "TRANSACTION_DELETED", "Transaction", transfer.transaction.id, {
      source: "petty-cash", pettyCashTransferId: id,
    })
  revalidatePettyCashPaths(transfer.sessionId)
}
