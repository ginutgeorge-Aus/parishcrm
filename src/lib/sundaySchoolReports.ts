// Sunday School class reports (pure, no DB): attendance summary, per-student
// attendance history and exam results grid, as plain string tables that the CSV
// and PDF renderers share. All numbers come from sundaySchoolStats.ts, with the
// same rules as the progress pages: a roll or exam before a child's enrolment
// day is left out unless a mark/score exists; unmarked rolls count as "unmarked",
// not absent; archived exams are excluded by the loader.

import type { AttendanceStatus } from "@/lib/generated/prisma/enums"
import { escapeCsv } from "@/lib/csvUtils"
import { formatDMY } from "@/lib/formatting"
import { ATTENDANCE_LABELS } from "@/lib/sundaySchoolRollView"
import { beforeEnrolment, formatPercent, summariseAttendance, summariseExams } from "@/lib/sundaySchoolStats"

export const REPORT_KINDS = ["summary", "history", "exams"] as const
/** Which report to build. */
export type ReportKind = (typeof REPORT_KINDS)[number]

/** Longest date range an export may cover (2 years, one leap day). */
export const MAX_RANGE_DAYS = 731

type Student = { personId: number; name: string; enrolledAt: Date }

/** Rows for one class and date range, as loaded from the DB (Decimals as strings, dates as `@db.Date`). */
export type ReportInput = {
  className: string
  /** Students (enrolled, not archived), in display order. */
  students: Student[]
  /** Rolls in range, oldest first. */
  sessions: { date: Date; marks: { personId: number; status: AttendanceStatus }[] }[]
  /** Live (non-archived) exams in range, oldest first. */
  exams: { id: number; name: string; date: Date; totalMarks: string; results: { personId: number; score: string }[] }[]
}

/** A titled table of string cells. */
export type ReportTable = { title: string; headers: string[]; rows: string[][] }

/**
 * One student's rolls in range: marked ones always, unmarked ones only from
 * the enrolment day on (same filter as the student progress page).
 * @param input the loaded rows
 * @param s the student
 */
function rollsFor(input: ReportInput, s: Student) {
  return input.sessions
    .map((sess) => ({ date: sess.date, status: sess.marks.find((m) => m.personId === s.personId)?.status ?? null }))
    .filter((r) => r.status !== null || !beforeEnrolment(r.date, s.enrolledAt))
}

/**
 * One student's score per exam in range (null = not scored). Exams that predate
 * enrolment and have no score for the child are dropped, as on the progress page.
 * @param input the loaded rows
 * @param s the student
 */
function scoresFor(input: ReportInput, s: Student) {
  return input.exams
    .map((exam) => ({ exam, score: exam.results.find((r) => r.personId === s.personId)?.score ?? null }))
    .filter((x) => x.score !== null || !beforeEnrolment(x.exam.date, s.enrolledAt))
}

/**
 * Class attendance summary: one row per student with counts and rate.
 * @param input the loaded rows
 */
export function attendanceSummaryTable(input: ReportInput): ReportTable {
  return {
    title: `${input.className} - attendance summary`,
    headers: ["Student", "Present", "Late", "Absent", "Unmarked", "Attendance rate"],
    rows: input.students.map((s) => {
      const rolls = rollsFor(input, s)
      const a = summariseAttendance(rolls.map((r) => r.status))
      return [s.name, String(a.present), String(a.late), String(a.absent), String(rolls.length - a.marked), formatPercent(a.rate)]
    }),
  }
}

/**
 * Student attendance history: one row per student per roll date in range.
 * @param input the loaded rows
 */
export function attendanceHistoryTable(input: ReportInput): ReportTable {
  return {
    title: `${input.className} - attendance history`,
    headers: ["Date", "Student", "Status"],
    rows: input.students.flatMap((s) =>
      rollsFor(input, s).map((r) => [formatDMY(r.date), s.name, r.status === null ? "Not marked" : ATTENDANCE_LABELS[r.status]]),
    ),
  }
}

/**
 * Exam results grid: students x live exams, "score / total" per cell (blank when
 * not scored), plus each student's average percent.
 * @param input the loaded rows
 */
export function examResultsTable(input: ReportInput): ReportTable {
  return {
    title: `${input.className} - exam results`,
    headers: ["Student", ...input.exams.map((e) => `${e.name} (${formatDMY(e.date)}) /${e.totalMarks}`), "Average"],
    rows: input.students.map((s) => {
      const scored = scoresFor(input, s)
      const avg = summariseExams(scored.flatMap((x) => (x.score === null ? [] : [{ score: x.score, totalMarks: x.exam.totalMarks }])))
      return [
        s.name,
        ...input.exams.map((e) => {
          const x = scored.find((y) => y.exam === e)
          return x?.score == null ? "" : `${x.score} / ${e.totalMarks}`
        }),
        formatPercent(avg.averagePercent),
      ]
    }),
  }
}

/**
 * Build the requested report table.
 * @param kind which report
 * @param input the loaded rows
 */
export function buildReport(kind: ReportKind, input: ReportInput): ReportTable {
  if (kind === "history") return attendanceHistoryTable(input)
  if (kind === "exams") return examResultsTable(input)
  return attendanceSummaryTable(input)
}

/**
 * Render a table as CSV; every cell (header included) goes through `escapeCsv`
 * (formula-injection guard, so a student named `=cmd` is neutralised).
 * @param t the table
 */
export function reportToCsv(t: ReportTable): string {
  return [t.headers, ...t.rows].map((line) => line.map(escapeCsv).join(",")).join("\n")
}

/**
 * Parse a `YYYY-MM-DD` that is a real calendar day, as UTC midnight (matching `@db.Date`).
 * @param v the raw query value
 */
export function parseYmd(v: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d
}

/**
 * Validate an export date range: to not before from, at most 2 years.
 * @param from inclusive start
 * @param to inclusive end
 */
export function validRange(from: Date, to: Date): boolean {
  const days = (to.getTime() - from.getTime()) / 86_400_000
  return days >= 0 && days <= MAX_RANGE_DAYS
}

/**
 * Filename-safe slug of a class name ("Year 1 / Blue" becomes "year-1-blue").
 * @param name the class name
 */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "class"
}
