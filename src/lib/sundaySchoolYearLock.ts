// Sunday School year lock: a rollover closes its source year (a
// SundaySchoolYearLock row, written in the rollover transaction). Every write to
// a class, teacher, enrolment or roll goes through lockLiveClass() so the check
// shares a transaction with the write.

import type { Prisma } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"

/** Shown when a mutation targets a year closed by rollover. */
export const YEAR_LOCKED = "This school year was rolled over and is locked — it can no longer be changed"

/** Outcome of lockLiveClass(): ok, class missing/archived, or its year is locked. */
export type ClassLockState = "ok" | "gone" | "locked"

/**
 * Inside a transaction, take FOR SHARE on the live class row (a concurrent
 * archive waits; a rollover's table lock queues behind us or we behind it), then
 * check the year's lock row with FOR SHARE too. Because the lock check is a
 * later statement at READ COMMITTED, a rollover that committed while we waited
 * is always seen. Returns "gone" for a missing/archived class, "locked" when its
 * year is closed.
 */
export async function lockLiveClass(tx: Prisma.TransactionClient, classId: number): Promise<ClassLockState> {
  // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
  const rows = await tx.$queryRaw<{ id: number; year: number }[]>`
    SELECT id, year FROM "SundaySchoolClass" WHERE id = ${classId} AND "archivedAt" IS NULL FOR SHARE`
  if (rows.length === 0) return "gone"
  return (await isYearLockedTx(tx, rows[0].year)) ? "locked" : "ok"
}

/** Transactional lock-row check (FOR SHARE) for a year. Module users: lockLiveClass, createClass. */
export async function isYearLockedTx(tx: Prisma.TransactionClient, year: number): Promise<boolean> {
  // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
  const rows = await tx.$queryRaw<{ year: number }[]>`
    SELECT year FROM "SundaySchoolYearLock" WHERE year = ${year} FOR SHARE`
  return rows.length > 0
}

/** Years (from `years`) that are locked, for pages deciding whether to show edit UI. */
export async function lockedYears(years: number[]): Promise<Set<number>> {
  if (years.length === 0) return new Set()
  const rows = await prisma.sundaySchoolYearLock.findMany({ where: { year: { in: years } }, select: { year: true } })
  return new Set(rows.map((r) => r.year))
}
