// Plain module (no "use server"): kept apart from pettyCashEntry.ts so that file
// stays free of DB/prisma imports for its pure-builder tests.
import { redirect } from "next/navigation"
import { logAuditTx } from "@/lib/audit"
import { isP2002, isP2034 } from "@/lib/validation"
import type { Prisma } from "@/lib/generated/prisma/client"
import { revalidatePettyCashPaths, SessionClosedError, SUBMISSION_TOKEN_REUSED_ERROR, type SubmissionTokenLookup } from "./pettyCashEntry"

/** Shown when a create's in-transaction audit write fails; the entry was rolled back. */
export const PETTY_CASH_AUDIT_FAILED_ERROR =
  "Couldn't record this entry in the audit log, so it was not saved. Sign out and back in, then try again."

/**
 * Thrown (inside the write transaction, so the entry rolls back) when the
 * "created" audit insert fails. A distinct, non-Prisma error so `serializableWrite`
 * neither retries it nor maps an FK failure (e.g. a deleted actor's userId, P2003)
 * to the misleading "was just removed" result; the action maps it to
 * `PETTY_CASH_AUDIT_FAILED_ERROR` instead of a 500.
 */
export class AuditWriteError extends Error {
  /** @param cause the underlying audit-insert failure, kept for server logs */
  constructor(cause: unknown) {
    super("petty-cash create audit write failed", { cause })
    this.name = "AuditWriteError"
  }
}

/**
 * Writes a create's audit row on the write transaction client. A failure throws
 * `AuditWriteError` (rolling the create back); a serialization conflict (P2034) is
 * rethrown unchanged so `serializableWrite` still retries the whole transaction.
 */
export async function logCreateAuditTx(
  tx: Prisma.TransactionClient,
  ...args: [userId: number | null, action: string, resourceType: string, resourceId: number, metadata: Record<string, unknown>]
): Promise<void> {
  try {
    await logAuditTx(tx, ...args)
  } catch (e) {
    if (isP2034(e)) throw e
    throw new AuditWriteError(e)
  }
}

/**
 * Lands a replayed create on the session page: the entry already committed, so
 * revalidate and redirect. Shared by receipt and expense creates.
 * Writes no audit row: the original create audits inside its own write
 * transaction (`logAuditTx`), so a committed entry always carries its "created"
 * row, attributed to the original actor and time. Re-logging on a replay would
 * fabricate a second event under the replayer's name and a fresh time (#563).
 * @param sessionId petty-cash session the replayed entry belongs to
 */
export async function finishReplay(sessionId: number): Promise<never> {
  revalidatePettyCashPaths(sessionId)
  return redirect(`/accounting/petty-cash/sessions/${sessionId}`)
}

/**
 * Re-checks the submission token just before a create returns a guard or warning
 * error: a concurrent twin of this very submit may have committed since the first
 * lookup, in which case this request is a replay and should redirect, not error.
 * Returns `finish()` on a replay, `reusedError` when the token now belongs to a
 * different entry, otherwise `error` unchanged. A failed lookup falls back to `error`
 * (the guard error is still the truthful answer); `finish` is outside the try because
 * `redirect()` throws.
 */
export async function replayOrError<E>(
  token: string | undefined,
  lookup: () => Promise<SubmissionTokenLookup>,
  finish: () => Promise<never>,
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
    if (found?.state === "replay") return finish()
    if (found?.state === "reused") return reusedError
  }
  return error
}

/**
 * Maps an error thrown by a receipt/expense create's write transaction to its
 * action result (shared so the two creates don't carry identical catch blocks).
 * - session closed mid-write: an `{ error }` unless a twin already committed this entry (then redirects);
 * - `AuditWriteError`: the entry rolled back, so say so (not "removed", not a 500);
 * - P2002 with a token: a concurrent twin won the unique index, so replay or report reuse;
 * - anything else rethrows.
 * @param e the caught error
 * @param label action name for the server log
 * @param token submission token, if the form sent one
 * @param lookup token-state lookup on the base client (`receiptTokenState` / `expenseTokenState`)
 * @param sessionId petty-cash session the entry belongs to
 */
export async function resolveCreateWriteError(
  e: unknown,
  label: string,
  token: string | undefined,
  lookup: () => Promise<SubmissionTokenLookup>,
  sessionId: number,
): Promise<{ error: string }> {
  const replayDone = () => finishReplay(sessionId)
  const reused = { error: SUBMISSION_TOKEN_REUSED_ERROR }
  if (e instanceof SessionClosedError) return replayOrError(token, lookup, replayDone, { error: e.message }, reused)
  if (e instanceof AuditWriteError) {
    console.error(`${label} audit write failed`, e.cause)
    return { error: PETTY_CASH_AUDIT_FAILED_ERROR }
  }
  if (token && isP2002(e)) {
    const { state } = await lookup()
    if (state === "replay") return replayDone()
    if (state === "reused") return reused
  }
  throw e
}
