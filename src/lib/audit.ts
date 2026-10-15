import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import type { Prisma } from "@/lib/generated/prisma/client"

/**
 * Logs an audit entry for a user action to the database.
 *
 * @param userId - The ID of the user performing the action, or null for anonymous.
 * @param action - The action performed by the user.
 * @param resourceType - The type of resource being acted upon.
 * @param resourceId - The ID of the resource being acted upon.
 * @param metadata - Additional metadata related to the action.
 * @param ip - The IP address from which the action was performed.
 * @returns A promise that resolves when the audit entry is created.
 */
export async function logAudit(
  userId: number | null,
  action: string,
  resourceType: string,
  resourceId?: number,
  metadata?: Record<string, unknown>,
  ip?: string
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        resourceType,
        resourceId,
        metadata: metadata as Prisma.InputJsonValue | undefined,
        ip,
      },
    })
  } catch (error) {
    // A failed audit write must never break the primary request — but it must be
    // observable. The audit log is the app's sole non-repudiation trail, so a
    // silent, systemic failure (DB outage, FK/schema drift) would otherwise go
    // unnoticed for its whole window. Log ids/action only — never PII.
    logger.error("audit log write failed", {
      action,
      resourceType,
      resourceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Write an audit row inside the caller's interactive transaction. Unlike
 * logAudit it does NOT swallow errors: a failed audit write throws, which rolls
 * back the mutation it records, so an audited change can never commit without
 * its history. Use it for safeguarding records and any mutation whose audit
 * trail must be guaranteed.
 * @param tx interactive-transaction client (`prisma.$transaction(async (tx) => …)`)
 * @param userId acting user, or null for system actions
 * @param action audit action code, e.g. "CLEARANCE_ADDED"
 * @param resourceType resource the action applies to, e.g. "Person"
 * @param resourceId id of that resource
 * @param metadata extra JSON (ids/flags only — never PII)
 * @param ip client IP, when known
 */
export async function logAuditTx(
  tx: Prisma.TransactionClient,
  userId: number | null,
  action: string,
  resourceType: string,
  resourceId?: number,
  metadata?: Record<string, unknown>,
  ip?: string
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId,
      action,
      resourceType,
      resourceId,
      metadata: metadata as Prisma.InputJsonValue | undefined,
      ip,
    },
  })
}

/** One audit row for {@link logAuditManyTx}. */
export type AuditEntry = {
  userId: number | null
  action: string
  resourceType: string
  resourceId?: number
  metadata?: Record<string, unknown>
  ip?: string
}

/**
 * Write several audit rows in one INSERT inside the caller's transaction.
 * Same guarantee as logAuditTx (a failure throws and rolls the mutation back),
 * without one round trip per row while the transaction holds its locks.
 * No-op for an empty list.
 * @param tx interactive-transaction client
 * @param entries rows to write (metadata: ids/flags only — never PII)
 */
export async function logAuditManyTx(tx: Prisma.TransactionClient, entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return
  await tx.auditLog.createMany({
    data: entries.map((e) => ({ ...e, metadata: e.metadata as Prisma.InputJsonValue | undefined })),
  })
}
