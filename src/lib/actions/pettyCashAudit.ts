// Plain module (no "use server"): kept apart from pettyCashEntry.ts so that file
// stays free of DB/prisma imports for its pure-builder tests.
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { redirect } from "next/navigation"
import { revalidatePettyCashPaths, SUBMISSION_TOKEN_REUSED_ERROR, type SubmissionTokenLookup } from "./pettyCashEntry"

/**
 * Writes an audit row unless one already exists for this action + resource.
 * Used on the token-replay path: the original request committed the entry, but
 * its (error-swallowing) `logAudit` may have failed — a retry must not leave the
 * entry unaudited, and must not double-log when the original did succeed.
 * Best-effort like `logAudit`: a failed lookup must not turn a replay of a saved entry into an error.
 * Known limit: check-then-write is not atomic. A plain double-submit whose twin takes the
 * replay path while the original's audit write is still in flight can log twice — not
 * vanishingly rare under double-clicks. Worst case is a duplicate "created" row, never a
 * missing one; accepted because the audit table is append-only and a schema-level fix
 * (unique key) is out of scope (#563).
 */
async function logAuditIfMissing(
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
  /** Whether the entry still exists — a backfill for an entry deleted meanwhile would be an orphan row. */
  entryExists: (id: number) => Promise<boolean>
}

/**
 * Lands a replayed create on the session page: the entry already committed, so
 * re-write its audit row if the original's failed, revalidate and redirect.
 * Shared by receipt and expense creates. The backfilled row is attributed to the
 * replaying user at the replay time (the original actor/time are unknowable), so it
 * carries `replayBackfill: true` — readers must not take it for the original event (#563).
 * Skipped when the entry no longer exists.
 */
async function finishReplay(entryId: number | undefined, a: ReplayAudit): Promise<never> {
  if (entryId !== undefined) {
    let exists = true
    try {
      exists = await a.entryExists(entryId)
    } catch (err) {
      console.error("finishReplay existence check failed", err)
    }
    if (exists) await logAuditIfMissing(a.userId, a.action, a.resourceType, entryId, { ...a.metadata, replayBackfill: true })
  }
  revalidatePettyCashPaths(a.sessionId)
  return redirect(`/accounting/petty-cash/sessions/${a.sessionId}`)
}

/**
 * Builds the `replayDone` / `orReplay` pair shared by receipt and expense creates:
 * `replayDone(id)` lands on the session page (backfilling a missing audit row);
 * `orReplay(error)` returns `error` unless a concurrent twin has since committed this
 * very entry (then redirects) or reused the token.
 */
export function makeReplayHandlers(opts: {
  token: string | undefined
  lookup: () => Promise<SubmissionTokenLookup>
  audit: ReplayAudit
}) {
  const replayDone = (id: number | undefined) => finishReplay(id, opts.audit)
  const orReplay = <E,>(error: E) =>
    replayOrError(opts.token, opts.lookup, replayDone, error, { error: SUBMISSION_TOKEN_REUSED_ERROR } as E)
  return { replayDone, orReplay }
}

/**
 * Re-checks the submission token just before a create returns a guard or warning
 * error: a concurrent twin of this very submit may have committed since the first
 * lookup, in which case this request is a replay and should redirect, not error.
 * Returns `finish(id)` on a replay, `reusedError` when the token now belongs to a
 * different entry, otherwise `error` unchanged. A failed lookup falls back to `error`
 * (the guard error is still the truthful answer); `finish` is outside the try because
 * `redirect()` throws.
 */
async function replayOrError<E>(
  token: string | undefined,
  lookup: () => Promise<SubmissionTokenLookup>,
  finish: (id: number | undefined) => Promise<never>,
  error: E,
  reusedError: E,
): Promise<E> {
  if (token) {
    let found: SubmissionTokenLookup | undefined
    try {
      found = await lookup()
    } catch (err) {
      console.error("replayOrError token re-check failed", err)
    }
    if (found?.state === "replay") return finish(found.id)
    if (found?.state === "reused") return reusedError
  }
  return error
}
