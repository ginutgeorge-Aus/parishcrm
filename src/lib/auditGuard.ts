import { logAuditTx } from "@/lib/audit"
import { isP2034 } from "@/lib/validation"
import type { Prisma } from "@/lib/generated/prisma/client"

/** Shown when an in-transaction audit write fails; the mutation was rolled back. */
export const AUDIT_FAILED_ERROR =
  "Couldn't record this change in the audit log, so it was not saved. Sign out and back in, then try again."

/**
 * Thrown (inside the write transaction, so the mutation rolls back) when an audit
 * insert fails. A distinct, non-Prisma error so `serializableWrite` neither retries
 * it nor maps an FK failure (e.g. a deleted actor's userId, P2003) to a misleading
 * "was just removed" / "still referenced" result, and so callers' own P2003 catches
 * never swallow it; actions map it to `AUDIT_FAILED_ERROR` instead of a 500.
 */
export class AuditWriteError extends Error {
  /** @param cause the underlying audit-insert failure, kept for server logs */
  constructor(cause: unknown) {
    super("audit write failed", { cause })
    this.name = "AuditWriteError"
  }
}

/**
 * Writes an audit row on the write transaction client. A failure throws
 * `AuditWriteError` (rolling the mutation back); a serialization conflict (P2034)
 * is rethrown unchanged so `serializableWrite` still retries the whole transaction.
 * Same args as `logAuditTx`.
 */
export async function logAuditGuardedTx(
  tx: Prisma.TransactionClient,
  ...args: [userId: number | null, action: string, resourceType: string, resourceId: number | undefined, metadata: Record<string, unknown>]
): Promise<void> {
  try {
    await logAuditTx(tx, ...args)
  } catch (e) {
    if (isP2034(e)) throw e
    throw new AuditWriteError(e)
  }
}
