// Plain module (no "use server"): kept apart from pettyCashEntry.ts so that file
// stays free of DB/prisma imports for its pure-builder tests.
import { AUDIT_FAILED_ERROR, AuditWriteError } from "@/lib/auditGuard"
import { isP2002 } from "@/lib/validation"
import { SessionClosedError, SUBMISSION_TOKEN_REUSED_ERROR, type SubmissionTokenLookup } from "./pettyCashEntry"

/** Shown when a create's in-transaction audit write fails; the entry was rolled back. */
export const PETTY_CASH_AUDIT_FAILED_ERROR = AUDIT_FAILED_ERROR

export { AuditWriteError }

/**
 * Maps a failed in-transaction audit write (the mutation rolled back) to the action
 * result, logging the cause server-side.
 * @param e the `AuditWriteError` caught from the write transaction
 * @param label action name for the server log
 */
export function auditFailed(e: AuditWriteError, label: string): { error: string } {
  console.error(`${label} audit write failed`, e.cause)
  return { error: PETTY_CASH_AUDIT_FAILED_ERROR }
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
 * @param replayDone lands on the session page (revalidate + redirect); the entry already committed with its own audit row
 */
export async function resolveCreateWriteError(
  e: unknown,
  label: string,
  token: string | undefined,
  lookup: () => Promise<SubmissionTokenLookup>,
  replayDone: () => Promise<never>,
): Promise<{ error: string }> {
  const reused = { error: SUBMISSION_TOKEN_REUSED_ERROR }
  if (e instanceof SessionClosedError) return replayOrError(token, lookup, replayDone, { error: e.message }, reused)
  if (e instanceof AuditWriteError) return auditFailed(e, label)
  if (token && isP2002(e)) {
    const { state } = await lookup()
    if (state === "replay") return replayDone()
    if (state === "reused") return reused
  }
  throw e
}
