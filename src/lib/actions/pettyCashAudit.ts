// Plain module (no "use server"): kept apart from pettyCashEntry.ts so that file
// stays free of DB/prisma imports for its pure-builder tests.
import { redirect } from "next/navigation"
import { revalidatePettyCashPaths, type SubmissionTokenLookup } from "./pettyCashEntry"

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
