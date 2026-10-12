// Sunday School year lock: a rollover closes its source year (a
// SundaySchoolYearLock row, written in the rollover transaction). Every write to
// a class, teacher, enrolment or roll goes through lockLiveClass() so the check
// shares a transaction — and the year's advisory lock — with the write.

import type { Prisma } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"

/** Shown when a mutation targets a year closed by rollover. */
export const YEAR_LOCKED = "This school year was rolled over and is locked — it can no longer be changed"

/** Outcome of lockLiveClass(): ok, class missing/archived, or its year is locked. */
export type ClassLockState = "ok" | "gone" | "locked"

/** First key of the per-year advisory lock (second key = school year). */
const YEAR_LOCK_NS = 7177

/**
 * Hold the year's advisory lock for the rest of the transaction: shared for a
 * write into the year, exclusive for closing it (rolloverYear,
 * lockSundaySchoolYear). The lock row alone can't order these — a writer that
 * read "no lock row" could still commit after the closer. Holding the advisory
 * lock across the check and the write means a closer waits for in-flight
 * writers, and a writer that queued behind a closer re-reads the committed row.
 * Closers must take it before their table locks, or a writer holding the
 * shared lock and waiting on the table lock would deadlock with them.
 */
export async function holdYear(tx: Prisma.TransactionClient, year: number, mode: "shared" | "exclusive"): Promise<void> {
  if (mode === "shared") {
    // nosemgrep: crm-no-raw-sql — advisory lock; Prisma has no locking API
    await tx.$queryRaw<unknown[]>`SELECT 1 FROM pg_advisory_xact_lock_shared(${YEAR_LOCK_NS}::int, ${year}::int)`
  } else {
    // nosemgrep: crm-no-raw-sql — advisory lock; Prisma has no locking API
    await tx.$queryRaw<unknown[]>`SELECT 1 FROM pg_advisory_xact_lock(${YEAR_LOCK_NS}::int, ${year}::int)`
  }
}

/**
 * Inside a transaction, take FOR SHARE (or FOR UPDATE, see `mode`) on the
 * live class row (a concurrent archive waits), then the year's shared advisory lock (see holdYear), then
 * check the year's lock row. Returns "gone" for a missing/archived class,
 * "locked" when its year is closed.
 */
export async function lockLiveClass(
  tx: Prisma.TransactionClient,
  classId: number,
  mode: "share" | "update" = "share",
): Promise<ClassLockState> {
  // "update" for callers that then update the class row itself: two such
  // callers holding FOR SHARE would each wait to upgrade it and deadlock.
  const rows = mode === "update"
    // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
    ? await tx.$queryRaw<{ id: number; year: number }[]>`
      SELECT id, year FROM "SundaySchoolClass" WHERE id = ${classId} AND "archivedAt" IS NULL FOR UPDATE`
    // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
    : await tx.$queryRaw<{ id: number; year: number }[]>`
      SELECT id, year FROM "SundaySchoolClass" WHERE id = ${classId} AND "archivedAt" IS NULL FOR SHARE`
  if (rows.length === 0) return "gone"
  await holdYear(tx, rows[0].year, "shared")
  return (await isYearLockedTx(tx, rows[0].year)) ? "locked" : "ok"
}

/**
 * Transactional lock-row check for a year. Callers must already hold the year's
 * advisory lock (holdYear) so the answer stays true until they commit.
 */
export async function isYearLockedTx(tx: Prisma.TransactionClient, year: number): Promise<boolean> {
  // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
  const rows = await tx.$queryRaw<{ year: number }[]>`
    SELECT year FROM "SundaySchoolYearLock" WHERE year = ${year} FOR SHARE`
  return rows.length > 0
}

/**
 * Count `personId`'s Sunday School rows (teacher, enrolment, attendance) in
 * locked years. A hard person delete would cascade them away and rewrite closed
 * history, so deletePerson refuses while this is non-zero. Run it in the
 * delete's Serializable transaction so a concurrent lock conflicts with it.
 */
export async function lockedYearRefs(tx: Prisma.TransactionClient, personId: number): Promise<number> {
  const years = (await tx.sundaySchoolYearLock.findMany({ select: { year: true } })).map((r) => r.year)
  if (years.length === 0) return 0
  const inLocked = { year: { in: years } }
  const [teaching, enrolled, marked] = await Promise.all([
    tx.sundaySchoolTeacher.count({ where: { personId, class: inLocked } }),
    tx.sundaySchoolEnrolment.count({ where: { personId, ...inLocked } }),
    tx.sundaySchoolAttendance.count({ where: { personId, session: { class: inLocked } } }),
  ])
  return teaching + enrolled + marked
}

/** Years (from `years`) that are locked, for pages deciding whether to show edit UI. */
export async function lockedYears(years: number[]): Promise<Set<number>> {
  if (years.length === 0) return new Set()
  const rows = await prisma.sundaySchoolYearLock.findMany({ where: { year: { in: years } }, select: { year: true } })
  return new Set(rows.map((r) => r.year))
}
