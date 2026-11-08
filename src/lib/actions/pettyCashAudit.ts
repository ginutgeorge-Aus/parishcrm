// Plain module (no "use server"): kept apart from pettyCashEntry.ts so that file
// stays free of DB/prisma imports for its pure-builder tests.
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { redirect } from "next/navigation"
import { revalidatePettyCashPaths, type SubmissionTokenLookup } from "./pettyCashEntry"

/**
 * Writes an audit row unless one already exists for this action + resource.
 * Used on the token-replay path: the original request committed the entry, but
 * its (error-swallowing) `logAudit` may have failed — a retry must not leave the
 * entry unaudited, and must not double-log when the original did succeed.
 * Best-effort like `logAudit`: a failed lookup must not turn a replay of a saved entry into an error.
 * Known limit: check-then-write is not atomic, so a concurrent twin and the original
 * can both log (a duplicate "created" row, never a missing one) — accepted as a very narrow race (#563).
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

/** Describes the entry a token replay resolved to, for the missing-audit backfill. */
export type ReplayAudit = {
  userId: number | null
  sessionId: number
  action: string
  resourceType: string
  metadata: Record<string, unknown>
}

/**
 * Lands a replayed create on the session page: the entry already committed, so
 * re-write its audit row if the original's failed, revalidate and redirect.
 * Shared by receipt and expense creates.
 */
export async function finishReplay(entryId: number | undefined, a: ReplayAudit): Promise<never> {
  if (entryId !== undefined) await logAuditIfMissing(a.userId, a.action, a.resourceType, entryId, a.metadata)
  revalidatePettyCashPaths(a.sessionId)
  return redirect(`/accounting/petty-cash/sessions/${a.sessionId}`)
}

/**
 * Re-checks the submission token just before a create returns a guard or warning
 * error: a concurrent twin of this very submit may have committed since the first
 * lookup, in which case this request is a replay and should redirect, not error.
 * Returns `finish(id)` on a replay, otherwise `error` unchanged.
 */
export async function replayOrError<E>(
  token: string | undefined,
  lookup: () => Promise<SubmissionTokenLookup>,
  finish: (id: number | undefined) => Promise<never>,
  error: E,
): Promise<E> {
  if (token) {
    const found = await lookup()
    if (found.state === "replay") return finish(found.id)
  }
  return error
}
