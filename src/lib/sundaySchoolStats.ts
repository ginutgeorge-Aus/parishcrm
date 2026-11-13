// Sunday School progress stats (pure helpers, no DB): attendance and exam
// summaries per child, per class and per grade (class level). Pages load the
// rows and pass plain values in, so these stay unit-testable and reusable.
//
// Definitions:
// - Attendance rate = (present + late) / marked rolls, whole percent. An
//   unmarked child on a roll is not counted either way. 100% only when nothing
//   is absent and 0% only when nothing is attended (199/200 shows 99%).
// - Exam average = mean of each result's score/total percent, every result
//   weighted equally. Scores are Decimal(10,2) strings; the ratio runs on
//   integer hundredths (BigInt), so no float parsing of the stored values.

import type { AttendanceStatus } from "@/lib/generated/prisma/enums"
import { MONEY_DECIMAL_RE } from "@/lib/validation"

/** Attendance counts plus the attended rate (whole percent, null = nothing marked). */
export type AttendanceSummary = {
  present: number
  late: number
  absent: number
  marked: number
  attended: number
  rate: number | null
}

/** Exam results count, their summed percent in basis points, and the rounded average percent. */
export type ExamSummary = {
  results: number
  /** Results not counted because the score or total is not a valid decimal, or the total is 0. */
  skipped: number
  /** Sum of each result's percent x100 (basis points); kept so summaries can be merged exactly. */
  totalBp: number
  averagePercent: number | null
}

/** One child's progress in a class. */
type StudentStats = {
  personId: number
  name: string
  attendance: AttendanceSummary
  exams: ExamSummary
}

/** Raw rows for one class, as loaded by a page. Strings for Decimal values (`.toString()`). */
export type ClassStatsInput = {
  id: number
  name: string
  level: number
  location: string
  /** Children counted (enrolled, not archived). Order is kept in `students`. */
  students: { personId: number; name: string }[]
  /** Every mark on this class's rolls; rows for children not in `students` are ignored. */
  attendance: { personId: number; status: AttendanceStatus }[]
  /** The class's live (non-archived) exams with their results. */
  exams: { totalMarks: string; results: { personId: number; score: string }[] }[]
}

/** A class's progress summary plus one row per child. */
export type ClassStats = {
  id: number
  name: string
  level: number
  location: string
  enrolled: number
  attendance: AttendanceSummary
  exams: ExamSummary
  students: StudentStats[]
}

/** Progress for every class at one level (grade) in a year. */
export type GradeStats = {
  level: number
  classCount: number
  enrolled: number
  attendance: AttendanceSummary
  exams: ExamSummary
}

/**
 * Whole-percent rate, or null when the denominator is 0. Rounded, but never
 * rounded up to 100 or down to 0 unless it is exact: 199/200 = 99, 1/300 = 1.
 * @param part numerator count
 * @param whole denominator count
 */
export function ratePercent(part: number, whole: number): number | null {
  if (whole === 0) return null
  const p = Math.round((part * 100) / whole)
  if (p === 100 && part < whole) return 99
  if (p === 0 && part > 0) return 1
  return p
}

/**
 * True when a roll or exam dated `date` (a `@db.Date`, UTC midnight) falls
 * before the day the child was enrolled, so it predates them in the class.
 * @param date the roll or exam date
 * @param enrolledAt the enrolment's `enrolledAt` timestamp
 */
export function beforeEnrolment(date: Date, enrolledAt: Date): boolean {
  const day = Date.UTC(enrolledAt.getUTCFullYear(), enrolledAt.getUTCMonth(), enrolledAt.getUTCDate())
  return date.getTime() < day
}

/**
 * Summarise a list of attendance marks; null (not marked) entries are ignored.
 * @param statuses one entry per roll row, null when the child was not marked
 */
export function summariseAttendance(statuses: readonly (AttendanceStatus | null)[]): AttendanceSummary {
  let present = 0, late = 0, absent = 0
  for (const s of statuses) {
    if (s === "PRESENT") present++
    else if (s === "LATE") late++
    else if (s === "ABSENT") absent++
  }
  return withRate({ present, late, absent })
}

/**
 * Add the derived marked/attended/rate fields to raw counts.
 * @param c present/late/absent counts
 */
function withRate(c: { present: number; late: number; absent: number }): AttendanceSummary {
  const attended = c.present + c.late
  const marked = attended + c.absent
  return { ...c, marked, attended, rate: ratePercent(attended, marked) }
}

/**
 * Combine several attendance summaries (e.g. classes into a grade).
 * @param parts summaries to add up
 */
export function mergeAttendance(parts: readonly AttendanceSummary[]): AttendanceSummary {
  const c = { present: 0, late: 0, absent: 0 }
  for (const p of parts) {
    c.present += p.present
    c.late += p.late
    c.absent += p.absent
  }
  return withRate(c)
}

/**
 * A Decimal(10,2) string as integer hundredths, or null when it is not a plain
 * non-negative decimal with at most 2 dp.
 * @param s the decimal string (Prisma Decimal `.toString()`)
 */
function hundredths(s: string): bigint | null {
  if (!MONEY_DECIMAL_RE.test(s)) return null
  const [whole, frac = ""] = s.split(".")
  return BigInt(whole) * BigInt(100) + BigInt(frac.padEnd(2, "0"))
}

/**
 * A score as a percent of its total, x100 (basis points), rounded half up:
 * "7.5" of "50" = 1500 (15.00%). Null when either value is not a valid
 * decimal or the total is 0.
 * @param score the child's score
 * @param totalMarks the exam's total
 */
export function scoreBasisPoints(score: string, totalMarks: string): number | null {
  const s = hundredths(score)
  const t = hundredths(totalMarks)
  if (s === null || t === null || t === BigInt(0)) return null
  // round(s * 10000 / t) in integers: (2*s*10000 + t) / (2*t)
  return Number((BigInt(2) * s * BigInt(10000) + t) / (BigInt(2) * t))
}

/**
 * Build an ExamSummary from summed basis points.
 * @param results number of results counted
 * @param totalBp their summed basis points
 * @param skipped number of results not counted (invalid score or total)
 */
function examSummary(results: number, totalBp: number, skipped: number): ExamSummary {
  return { results, skipped, totalBp, averagePercent: results === 0 ? null : Math.round(totalBp / results / 100) }
}

/**
 * Summarise exam results. Invalid rows (bad decimal, zero total) are not
 * averaged but are counted in `skipped`, so the page can say so.
 * @param results one score/total pair per result
 */
export function summariseExams(results: readonly { score: string; totalMarks: string }[]): ExamSummary {
  let n = 0, bp = 0, skipped = 0
  for (const r of results) {
    const v = scoreBasisPoints(r.score, r.totalMarks)
    if (v === null) {
      skipped++
      continue
    }
    n++
    bp += v
  }
  return examSummary(n, bp, skipped)
}

/**
 * Combine exam summaries, weighting every result equally.
 * @param parts summaries to add up
 */
export function mergeExams(parts: readonly ExamSummary[]): ExamSummary {
  let n = 0, bp = 0, skipped = 0
  for (const p of parts) {
    n += p.results
    bp += p.totalBp
    skipped += p.skipped
  }
  return examSummary(n, bp, skipped)
}

/**
 * "N results not counted" note for an ExamSummary, or null when none were skipped.
 * @param exams the summary
 */
export function skippedNote(exams: ExamSummary): string | null {
  if (exams.skipped === 0) return null
  return `${exams.skipped} ${exams.skipped === 1 ? "result" : "results"} not counted`
}

/**
 * Display a whole percent; null shows an em dash (no data yet).
 * @param p percent or null
 */
export function formatPercent(p: number | null): string {
  return p === null ? "—" : `${p}%`
}

/**
 * Per-child and class totals for one class. Only children in `students`
 * count, so a child who moved out doesn't skew this class's numbers, and the
 * class totals always equal the sum of the rows shown.
 * @param input the class's raw rows
 */
export function classStats(input: ClassStatsInput): ClassStats {
  const marks = new Map<number, AttendanceStatus[]>()
  const scores = new Map<number, { score: string; totalMarks: string }[]>()
  for (const s of input.students) {
    marks.set(s.personId, [])
    scores.set(s.personId, [])
  }
  for (const a of input.attendance) marks.get(a.personId)?.push(a.status)
  for (const e of input.exams) {
    for (const r of e.results) scores.get(r.personId)?.push({ score: r.score, totalMarks: e.totalMarks })
  }
  const students = input.students.map((s) => ({
    personId: s.personId,
    name: s.name,
    attendance: summariseAttendance(marks.get(s.personId) ?? []),
    exams: summariseExams(scores.get(s.personId) ?? []),
  }))
  return {
    id: input.id,
    name: input.name,
    level: input.level,
    location: input.location,
    enrolled: students.length,
    attendance: mergeAttendance(students.map((s) => s.attendance)),
    exams: mergeExams(students.map((s) => s.exams)),
    students,
  }
}

/**
 * Roll classes up by level (grade), lowest level first.
 * @param classes per-class stats for one year
 */
export function gradeStats(classes: readonly ClassStats[]): GradeStats[] {
  const byLevel = new Map<number, ClassStats[]>()
  for (const c of classes) byLevel.set(c.level, [...(byLevel.get(c.level) ?? []), c])
  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, rows]) => ({
      level,
      classCount: rows.length,
      enrolled: rows.reduce((n, c) => n + c.enrolled, 0),
      attendance: mergeAttendance(rows.map((c) => c.attendance)),
      exams: mergeExams(rows.map((c) => c.exams)),
    }))
}
