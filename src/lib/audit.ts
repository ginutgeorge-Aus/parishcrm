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
