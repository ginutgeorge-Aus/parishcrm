// Sunday School progress stats (pure helpers, no DB): attendance and exam
// summaries per child, per class and per grade (class level). Pages load the
// rows and pass plain values in, so these stay unit-testable and reusable.
//
// Definitions:
// - Attendance rate = (present + late) / marked rolls, whole percent. An
//   unmarked child on a roll is not counted either way. 100% only when nothing
//   is absent and 0% only when nothing is attended (199/200 shows 99%).
// - Exam average = mean of each result's score/total percent, every result
//   weighted equally. Scores are Decimal(10,2) strings; the ratios are summed
//   as an exact BigInt fraction and rounded once, at the end, so no float
//   parsing of the stored values and no per-result rounding drift.

import type { AttendanceStatus } from "@/lib/generated/prisma/enums"
import { MONEY_DECIMAL_RE } from "@/lib/validation"
import { sydneyParts } from "@/lib/dates"

/** Attendance counts plus the attended rate (whole percent, null = nothing marked). */
export type AttendanceSummary = {
  present: number
  late: number
  absent: number
  marked: number
  attended: number
  rate: number | null
}

/** Exam results count, the exact sum of their score/total ratios, and the rounded average percent. */
export type ExamSummary = {
  results: number
  /** Results not counted because the score or total is not a valid decimal, or the total is 0. */
  skipped: number
  /**
   * Sum of the counted scores (hundredths), keyed by exam total (hundredths); kept so summaries
   * merge exactly without rounding. Size is the number of distinct totals, and no common
   * denominator is accumulated: it is formed only when the average is computed.
   */
  ratioSum: ReadonlyMap<bigint, bigint>
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
  /**
   * Marks on this class's rolls; rows for children not in `students` are ignored.
   * `count` (default 1) lets a loader pass pre-grouped counts instead of one row per mark;
   * it must be a non-negative integer (anything else counts as 0).
   */
  attendance: { personId: number; status: AttendanceStatus; count?: number }[]
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
 * before the (church-timezone) day the child was enrolled, so it predates them in the class.
 * @param date the roll or exam date
 * @param enrolledAt the enrolment's `enrolledAt` timestamp
 */
export function beforeEnrolment(date: Date, enrolledAt: Date): boolean {
  const { year, month, day } = sydneyParts(enrolledAt)
  return date.getTime() < Date.UTC(year, month - 1, day)
}

/**
 * Summarise a list of attendance marks; null (not marked) entries are ignored.
 * @param statuses one entry per roll row, null when the child was not marked
 */
export function summariseAttendance(statuses: readonly (AttendanceStatus | null)[]): AttendanceSummary {
  const c = { present: 0, late: 0, absent: 0 }
  for (const s of statuses) tally(c, s, 1)
  return withRate(c)
}

/**
 * Add `n` marks of one status to the counters; a null (unmarked) status adds nothing.
 * The single status-to-counter mapping shared by `summariseAttendance` and `classStats`.
 * @param c counters to mutate
 * @param status the mark, or null when not marked
 * @param n how many marks to add (non-negative integer)
 */
function tally(c: { present: number; late: number; absent: number }, status: AttendanceStatus | null, n: number): void {
  if (status === "PRESENT") c.present += n
  else if (status === "LATE") c.late += n
  else if (status === "ABSENT") c.absent += n
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
 * Greatest common divisor of two non-negative BigInts.
 * @param a first value
 * @param b second value
 */
function gcd(a: bigint, b: bigint): bigint {
  while (b !== BigInt(0)) [a, b] = [b, a % b]
  return a
}

/**
 * Add `score` (hundredths) to the running sum for exams out of `total` (hundredths).
 * @param sums per-total score sums to mutate
 * @param total the exam total, in hundredths (non-zero)
 * @param score score sum to add, in hundredths
 */
function addToTotal(sums: Map<bigint, bigint>, total: bigint, score: bigint): void {
  sums.set(total, (sums.get(total) ?? BigInt(0)) + score)
}

/**
 * Build an ExamSummary from per-total score sums; the average is rounded half
 * up once: round(sum(score/total) * 100 / results). The common denominator
 * (LCM of the distinct totals) is only formed here, never stored or accumulated.
 * @param results number of results counted
 * @param ratioSum score sums (hundredths) keyed by exam total (hundredths)
 * @param skipped number of results not counted (invalid score or total)
 */
function examSummary(results: number, ratioSum: ReadonlyMap<bigint, bigint>, skipped: number): ExamSummary {
  if (results === 0) return { results, skipped, ratioSum, averagePercent: null }
  let den = BigInt(1)
  for (const t of ratioSum.keys()) den = (den / gcd(den, t)) * t
  let num = BigInt(0)
  for (const [t, s] of ratioSum) num += s * (den / t)
  const n = BigInt(results)
  // round(num * 100 / (den * n)) in integers: (2*num*100 + den*n) / (2*den*n)
  const avg = (BigInt(200) * num + den * n) / (BigInt(2) * den * n)
  return { results, skipped, ratioSum, averagePercent: Number(avg) }
}

/**
 * Summarise exam results. Invalid rows (bad decimal, zero total) are not
 * averaged but are counted in `skipped`, so the page can say so.
 * @param results one score/total pair per result
 */
export function summariseExams(results: readonly { score: string; totalMarks: string }[]): ExamSummary {
  let n = 0, skipped = 0
  const sum = new Map<bigint, bigint>()
  for (const r of results) {
    const s = hundredths(r.score)
    const t = hundredths(r.totalMarks)
    if (s === null || t === null || t === BigInt(0)) {
      skipped++
      continue
    }
    n++
    addToTotal(sum, t, s)
  }
  return examSummary(n, sum, skipped)
}

/**
 * Combine exam summaries, weighting every result equally.
 * @param parts summaries to add up
 */
export function mergeExams(parts: readonly ExamSummary[]): ExamSummary {
  let n = 0, skipped = 0
  const sum = new Map<bigint, bigint>()
  for (const p of parts) {
    n += p.results
    for (const [t, s] of p.ratioSum) addToTotal(sum, t, s)
    skipped += p.skipped
  }
  return examSummary(n, sum, skipped)
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
 * @param opts `students: false` skips building per-child summaries (`students` is
 *   empty); class totals are then merged straight from the raw rows and are identical.
 */
export function classStats(input: ClassStatsInput, opts: { students?: boolean } = {}): ClassStats {
  const marks = new Map<number, { present: number; late: number; absent: number }>()
  const scores = new Map<number, { score: string; totalMarks: string }[]>()
  // A child listed twice would be counted twice in the full path but once in the lean path; keep the first.
  const roster: ClassStatsInput["students"] = []
  for (const s of input.students) {
    if (marks.has(s.personId)) continue
    roster.push(s)
    marks.set(s.personId, { present: 0, late: 0, absent: 0 })
    scores.set(s.personId, [])
  }
  for (const a of input.attendance) {
    const c = marks.get(a.personId)
    if (!c) continue
    // `count` is a non-negative integer; anything else (negative, fractional, NaN) counts as 0.
    const raw = a.count ?? 1
    tally(c, a.status, Number.isInteger(raw) && raw > 0 ? raw : 0)
  }
  for (const e of input.exams) {
    for (const r of e.results) scores.get(r.personId)?.push({ score: r.score, totalMarks: e.totalMarks })
  }
  let students: StudentStats[] = []
  let attendance: AttendanceSummary
  let exams: ExamSummary
  if (opts.students === false) {
    const total = { present: 0, late: 0, absent: 0 }
    for (const c of marks.values()) {
      total.present += c.present
      total.late += c.late
      total.absent += c.absent
    }
    attendance = withRate(total)
    exams = summariseExams([...scores.values()].flat())
  } else {
    students = roster.map((s) => ({
      personId: s.personId,
      name: s.name,
      attendance: withRate(marks.get(s.personId) ?? { present: 0, late: 0, absent: 0 }),
      exams: summariseExams(scores.get(s.personId) ?? []),
    }))
    attendance = mergeAttendance(students.map((s) => s.attendance))
    exams = mergeExams(students.map((s) => s.exams))
  }
  return {
    id: input.id,
    name: input.name,
    level: input.level,
    location: input.location,
    enrolled: roster.length,
    attendance,
    exams,
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
