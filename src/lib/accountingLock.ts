import { prisma } from "@/lib/prisma"

/** AppSetting key holding the accounting lock date (YYYY-MM-DD). */
export const ACCOUNTING_LOCK_DATE_KEY = "accountingLockDate"

/**
 * Read the configured accounting lock date. Returns a UTC-midnight Date, or
 * null when unset / blank / unparseable. Transactions dated on or before this
 * date are read-only.
 */
export async function getAccountingLockDate(): Promise<Date | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: ACCOUNTING_LOCK_DATE_KEY } })
  if (!row || !row.value) return null
  const d = new Date(row.value) // "YYYY-MM-DD" → UTC midnight
  return isNaN(d.getTime()) ? null : d
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
 * Returns a user-facing error string when `date` is in the locked period,
 * else null. Callers return `{ error }` (actions) or a 400 (API routes).
 */
export async function assertUnlocked(date: Date): Promise<string | null> {
  const lock = await getAccountingLockDate()
  if (!isDateLocked(date, lock)) return null
  return `This date is in a locked accounting period (on or before ${lock!.toISOString().slice(0, 10)}).`
}
