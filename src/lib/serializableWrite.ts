import { randomInt } from "node:crypto"
import { prisma } from "@/lib/prisma"
// Value import from the generated client, not the @/lib/prisma re-export: tests that
// mock @/lib/prisma as `{ prisma }` would otherwise lose the isolation-level enum.
import { Prisma } from "@/lib/generated/prisma/client"
import { isP2003, isP2034 } from "@/lib/validation"

const MAX_TX_ATTEMPTS = 3

/**
 * Jittered exponential delay before retrying a Serializable transaction that
 * lost an SSI conflict (P2034). Spreads out concurrent writers so they do not
 * all collide again on the next attempt.
 *
 * @param attempt - 1-based attempt that just failed.
 * @returns Delay in milliseconds (0 up to just under 25ms * 2^(attempt-1), capped at 200ms).
 */
export function serializationBackoffMs(attempt: number): number {
  return randomInt(Math.min(200, 25 * 2 ** (attempt - 1)))
}

/**
 * Run a write that validates what it references (e.g. an account's type) and inserts/updates in one Serializable
 * transaction.
 *
 * Ordering vs `updateAccount` (retype) and `deleteAccount`: those run Serializable too, and read the rows that point
 * at the account. This write reads the account then writes a row pointing at it. Each side reads what the other
 * writes, so Postgres sees a dependency cycle and aborts one of them (P2034) instead of letting both commit — a row
 * can never land on an account that was retyped or deleted in the same instant. The loser is retried: the re-run
 * re-validates against the committed state and returns the caller's normal validation error, or succeeds. After
 * `MAX_TX_ATTEMPTS` conflicts it returns `busy`. Each P2034 retry waits a jittered backoff first so racing writers
 * do not collide again in lockstep.
 *
 * An FK violation (P2003) is retried once — the re-run's validation catches a deleted account. A second P2003 means
 * a reference the body doesn't re-check (fund, party, payment account…) is gone, which no retry can fix, so it
 * returns `gone` instead of a misleading "try again".
 * @param fn - the validate-then-write body, run against the transaction client
 * @param busy - result returned when every attempt hit a conflict
 * @param gone - result returned when a referenced row stays missing (defaults to `busy`)
 */
export function serializableWrite<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  busy: { error: string },
  gone: { error: string } = busy,
): Promise<T | { error: string }> {
  return runAttempt(fn, busy, gone, 1, 0)
}

/**
 * One attempt of `serializableWrite`; recurses for the next attempt instead of
 * looping, so each retry is a fresh call rather than an await inside a loop.
 * @param fn - the validate-then-write body
 * @param busy - result when every attempt hit a conflict
 * @param gone - result when a referenced row stays missing
 * @param attempt - 1-based attempt number
 * @param fkFailures - P2003 failures so far
 */
async function runAttempt<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  busy: { error: string },
  gone: { error: string },
  attempt: number,
  fkFailures: number,
): Promise<T | { error: string }> {
  try {
    return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (e) {
    const fk = isP2003(e)
    if (!fk && !isP2034(e)) throw e
    const failures = fkFailures + (fk ? 1 : 0)
    if (fk && failures >= 2) return gone
    if (attempt >= MAX_TX_ATTEMPTS) return busy
    // Only an SSI conflict benefits from a pause; an FK retry re-validates against already-committed state.
    if (!fk) await new Promise((resolve) => setTimeout(resolve, serializationBackoffMs(attempt)))
    return runAttempt(fn, busy, gone, attempt + 1, failures)
  }
}
