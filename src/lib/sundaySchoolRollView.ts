import type { AttendanceStatus } from "@/lib/generated/prisma/enums"
import { isRealCalendarDate } from "@/lib/validation"

/** Roll button order (most common first). */
export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["PRESENT", "LATE", "ABSENT"]

/** Human labels for each status. */
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent" }

/** One child on a roll. `status` null = not marked; `enrolled` false = marked earlier, since moved out. */
export type RollRow = { personId: number; name: string; status: AttendanceStatus | null; enrolled: boolean }

/**
 * Validate a roll's `?date=`. Blank = today (Sydney YMD supplied by caller).
 * Must be a real calendar date, not in the future, and inside the class's
 * school year (AU school year = calendar year).
 */
export function parseRollDate(
  raw: string | undefined,
  classYear: number,
  todayYMD: string,
): { ok: true; ymd: string } | { ok: false; error: string } {
  const ymd = raw?.trim() || todayYMD
  if (!isRealCalendarDate(ymd)) return { ok: false, error: "Invalid date" }
  if (ymd > todayYMD) return { ok: false, error: "Can't take a roll for a future date" }
  if (ymd.slice(0, 4) !== String(classYear)) return { ok: false, error: `This class is for ${classYear}` }
  return { ok: true, ymd }
}

/** Parse a status from the client. `null` = clear the mark; `undefined` = invalid input. */
export function parseAttendanceStatus(v: unknown): AttendanceStatus | null | undefined {
  if (v === null) return null
  return typeof v === "string" && (ATTENDANCE_STATUSES as string[]).includes(v) ? (v as AttendanceStatus) : undefined
}

/** Summary counts for a roll. Late counts as attended. */
export function rollCounts(rows: Pick<RollRow, "status">[]) {
  const c = { present: 0, late: 0, absent: 0, unmarked: 0, attended: 0 }
  for (const r of rows) {
    if (r.status === "PRESENT") c.present++
    else if (r.status === "LATE") c.late++
    else if (r.status === "ABSENT") c.absent++
    else c.unmarked++
  }
  c.attended = c.present + c.late
  return c
}

/** A validated `YYYY-MM-DD` as the UTC-midnight Date stored in `@db.Date` columns. */
export function ymdToDbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}
