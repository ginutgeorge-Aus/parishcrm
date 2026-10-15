import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import type { Prisma } from "@/lib/generated/prisma/client"

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
