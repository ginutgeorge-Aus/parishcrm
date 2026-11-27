import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"

/** AppSetting key holding the accounting lock date (YYYY-MM-DD). */
export const ACCOUNTING_LOCK_DATE_KEY = "accountingLockDate"

/**
 * Read the configured accounting lock date. Returns a UTC-midnight Date, or
 * null when unset / blank / unparseable. Transactions dated on or before this
 * date are read-only.
 * @param db client to read through; pass a transaction client to read the lock inside that transaction (default: the shared client)
 */
export async function getAccountingLockDate(db: Pick<typeof prisma, "appSetting"> = prisma): Promise<Date | null> {
  const row = await db.appSetting.findUnique({ where: { key: ACCOUNTING_LOCK_DATE_KEY } })
  if (!row?.value) return null
  const d = new Date(row.value) // "YYYY-MM-DD" → UTC midnight
  return Number.isNaN(d.getTime()) ? null : d
}

/** Advisory-lock namespace for the accounting lock date (distinct from the Sunday School year lock). */
const ACCOUNTING_LOCK_NS = 7178

/**
 * Hold the accounting-lock advisory lock for the rest of the transaction:
 * shared for a write that must not land in a locked period (statement save and
 * reconcile), exclusive for changing the lock date. A plain read of the lock
 * setting cannot order these: a lock change could commit after the check but
 * before the write commits. With the lock held, the lock-date change waits for
 * in-flight writers, and a writer that queued behind it must re-read the lock
 * AFTER acquiring this (and through a fresh connection, not the transaction's
 * snapshot, which predates the wait under Serializable).
 * Closers (the lock-date setter) must take it before any other lock they need.
 */
export async function holdAccountingLock(tx: Prisma.TransactionClient, mode: "shared" | "exclusive"): Promise<void> {
  if (mode === "shared") {
    // nosemgrep: crm-no-raw-sql — advisory lock; Prisma has no locking API
    await tx.$queryRaw<unknown[]>`SELECT 1 FROM pg_advisory_xact_lock_shared(${ACCOUNTING_LOCK_NS}::int, 0)`
  } else {
    // nosemgrep: crm-no-raw-sql — advisory lock; Prisma has no locking API
    await tx.$queryRaw<unknown[]>`SELECT 1 FROM pg_advisory_xact_lock(${ACCOUNTING_LOCK_NS}::int, 0)`
  }
}

/** Pure: a date is locked when it falls on or before the lock date (inclusive). */
export function isDateLocked(date: Date, lock: Date | null): boolean {
  if (lock === null) return false
  // The lock is UTC midnight of the lock date, but a transaction date read from
  // the DB can carry a non-zero time component. Comparing raw timestamps would
  // let a same-calendar-day transaction dated after midnight slip past the lock
  //. Normalise the compared date to its own UTC midnight so the
  // check is purely by calendar day and stays inclusive of the lock date.
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return dayStart <= lock.getTime()
}

/**
 * User-facing message for a date that falls in the locked period.
 * @param lock the accounting lock date
 */
export function lockedPeriodMessage(lock: Date): string {
  return `This date is in a locked accounting period (on or before ${lock.toISOString().slice(0, 10)}).`
}

/**
 * Returns a user-facing error string when `date` is in the locked period,
 * else null. Callers return `{ error }` (actions) or a 400 (API routes).
 * This is a pre-check only: a write must re-check with assertUnlockedTx inside
 * its transaction, or a lock change committed in between lets it land.
 */
export async function assertUnlocked(date: Date): Promise<string | null> {
  const lock = await getAccountingLockDate()
  if (lock === null || !isDateLocked(date, lock)) return null
  return lockedPeriodMessage(lock)
}

/**
 * In-transaction period-lock check (AUD-3-08). Takes the shared accounting
 * advisory lock (held until the transaction ends), then reads the lock date.
 * A concurrent setAccountingLockDate (exclusive) therefore either committed
 * before this read, so the read sees it, or waits until this transaction
 * commits, so no write can land in a period locked meanwhile.
 * The lock date is read through the shared client, not `tx`: under Serializable
 * the transaction's snapshot predates the wait for the advisory lock and could
 * miss a lock change committed while it waited (see holdAccountingLock).
 * Call it before the transaction's first write, so returning the error (rather
 * than throwing) never commits a partial write.
 * @param tx the write's transaction client
 * @param date the earliest date the write touches (the lock is inclusive, so the earliest date decides)
 * @param message builds the user-facing message from the lock date (default: lockedPeriodMessage)
 * @returns the user-facing error when `date` is locked, else null
 */
export async function assertUnlockedTx(
  tx: Prisma.TransactionClient,
  date: Date,
  message: (lock: Date) => string = lockedPeriodMessage,
): Promise<string | null> {
  await holdAccountingLock(tx, "shared")
  const lock = await getAccountingLockDate()
  if (lock === null || !isDateLocked(date, lock)) return null
  return message(lock)
}
