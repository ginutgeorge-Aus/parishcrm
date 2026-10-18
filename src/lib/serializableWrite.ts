import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma/client"
import { isP2003, isP2034 } from "@/lib/validation"

const MAX_TX_ATTEMPTS = 3

/**
 * Run a write that validates what it references (e.g. an account's type) and inserts/updates in one Serializable
 * transaction.
 *
 * Ordering vs `updateAccount` (retype) and `deleteAccount`: those run Serializable too, and read the rows that point
 * at the account. This write reads the account then writes a row pointing at it. Each side reads what the other
 * writes, so Postgres sees a dependency cycle and aborts one of them (P2034) instead of letting both commit — a row
 * can never land on an account that was retyped or deleted in the same instant. The loser is retried: the re-run
 * re-validates against the committed state and returns the caller's normal validation error, or succeeds. After
 * `MAX_TX_ATTEMPTS` conflicts it returns `busy`.
 *
 * An FK violation (P2003) is retried once — the re-run's validation catches a deleted account. A second P2003 means
 * a reference the body doesn't re-check (fund, party, payment account…) is gone, which no retry can fix, so it
 * returns `gone` instead of a misleading "try again".
 * @param fn - the validate-then-write body, run against the transaction client
 * @param busy - result returned when every attempt hit a conflict
 * @param gone - result returned when a referenced row stays missing (defaults to `busy`)
 */
export async function serializableWrite<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  busy: { error: string },
  gone: { error: string } = busy,
): Promise<T | { error: string }> {
  let fkFailures = 0
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (e) {
      if (isP2003(e)) {
        if (++fkFailures >= 2) return gone
      } else if (!isP2034(e)) throw e
      if (attempt >= MAX_TX_ATTEMPTS) return busy
    }
  }
}
