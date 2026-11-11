import { logAuditGuardedTx } from "@/lib/auditGuard"
import type { Prisma } from "@/lib/generated/prisma/client"

type EntryKind = "Receipt" | "Expense"

/**
 * Writes the create/update audit row for a petty cash receipt or expense inside
 * the caller's transaction, so the audit commits or rolls back with the mutation.
 * A failed audit write throws `AuditWriteError` (see `logAuditGuardedTx`) so the
 * action can report it instead of a 500 or a misleading P2003 mapping; P2034 is rethrown for retry.
 */
export async function logPettyCashEntryAuditTx(
  tx: Prisma.TransactionClient,
  userId: number | null,
  kind: EntryKind,
  verb: "CREATED" | "UPDATED",
  id: number,
  data: { amount: string; accountId: number },
  sessionId: number
): Promise<void> {
  await logAuditGuardedTx(tx, userId, `PETTY_CASH_${kind.toUpperCase()}_${verb}`, `PettyCash${kind}`, id, {
    amount: data.amount,
    accountId: data.accountId,
    sessionId,
  })
}

/**
 * Writes the delete audit rows for a petty cash receipt or expense inside the
 * caller's transaction. The mirrored ledger row is removed by FK cascade, so it
 * is logged explicitly to avoid a ghost deletion in the Transaction audit trail.
 */
export async function logPettyCashEntryDeletedAuditTx(
  tx: Prisma.TransactionClient,
  userId: number | null,
  kind: EntryKind,
  id: number,
  entry: { amount: unknown; accountId: number; sessionId: number; transaction: { id: number } | null }
): Promise<void> {
  await logAuditGuardedTx(tx, userId, `PETTY_CASH_${kind.toUpperCase()}_DELETED`, `PettyCash${kind}`, id, {
    amount: Number(entry.amount),
    accountId: entry.accountId,
    sessionId: entry.sessionId,
  })
  if (entry.transaction)
    await logAuditGuardedTx(tx, userId, "TRANSACTION_DELETED", "Transaction", entry.transaction.id, {
      source: "petty-cash",
      [`pettyCash${kind}Id`]: id,
    })
}
