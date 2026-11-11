// Plain module (no "use server"): kept apart from pettyCashEntry.ts so that file
// stays free of DB/prisma imports for its pure-builder tests.
import { redirect } from "next/navigation"
import { AUDIT_FAILED_ERROR, AuditWriteError, logAuditGuardedTx } from "@/lib/auditGuard"
import { isP2002 } from "@/lib/validation"
import { revalidatePettyCashPaths, SessionClosedError, SUBMISSION_TOKEN_REUSED_ERROR, type SubmissionTokenLookup } from "./pettyCashEntry"

/** Shown when a create's in-transaction audit write fails; the entry was rolled back. */
export const PETTY_CASH_AUDIT_FAILED_ERROR = AUDIT_FAILED_ERROR

export { AuditWriteError }

/**
 * Maps a failed in-transaction audit write (the mutation rolled back) to the action
 * result, logging the cause server-side.
 * @param e the `AuditWriteError` caught from the write transaction
 */
export function auditFailed(e: AuditWriteError): { error: string } {
  console.error("petty-cash audit write failed", e.cause)
  return { error: PETTY_CASH_AUDIT_FAILED_ERROR }
}

/**
 * Writes a create's audit row on the write transaction client (see `logAuditGuardedTx`).
 * Kept as the create-path name used by the receipt/expense actions.
 */
export const logCreateAuditTx = logAuditGuardedTx

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
