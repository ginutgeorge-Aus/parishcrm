// Plain module (no "use server"): kept apart from pettyCashEntry.ts so that file
// stays free of DB/prisma imports for its pure-builder tests.
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

/**
 * Writes an audit row unless one already exists for this action + resource.
 * Used on the token-replay path: the original request committed the entry, but
 * its (error-swallowing) `logAudit` may have failed — a retry must not leave the
 * entry unaudited, and must not double-log when the original did succeed.
 * Best-effort like `logAudit`: a failed lookup must not turn a replay of a saved entry into an error.
 */
export async function logAuditIfMissing(
  userId: number | null,
  action: string,
  resourceType: string,
  resourceId: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const found = await prisma.auditLog.findFirst({ where: { action, resourceType, resourceId }, select: { id: true } })
    if (!found) await logAudit(userId, action, resourceType, resourceId, metadata)
  } catch (err) {
    console.error("logAuditIfMissing failed", err)
  }
}
