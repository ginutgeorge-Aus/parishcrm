// Sunday School reports (OSS-13), pure helpers: report options from the URL,
// and the report table (headers + rows) built from already-loaded class data.
// The same table feeds the on-screen preview, the Excel export and the PDF.

import type { AttendanceStatus } from "@/lib/generated/prisma/enums"
import { parseSchoolYear } from "@/lib/sundaySchool"
import { parseRouteId, MONEY_DECIMAL_RE } from "@/lib/validation"

/** Optional column groups, in display order. The child's name is always shown. */
export const REPORT_COLUMNS = ["family", "attendance", "marks"] as const
export type ReportColumn = (typeof REPORT_COLUMNS)[number]

/** Labels for the column picker. */
export const REPORT_COLUMN_LABELS: Record<ReportColumn, string> = {
  family: "Family",
  attendance: "Attendance (present, late, absent, %)",
  marks: "Exam marks",
}

const DEFAULT_COLUMNS: ReportColumn[] = ["attendance", "marks"]

/** What the user picked: a school year, one class (null = all classes) and column groups. */
export type ReportOptions = { year: number; classId: number | null; columns: ReportColumn[] }

/**
 * Read report options from a query string. `applied=1` marks a submitted
 * picker form, so an empty `col` list then means "name only"; without it
 * (first visit) the default columns are used. Unknown columns are dropped.
 * @param sp the request's search params
 * @param at "now", for the default school year
 */
export function parseReportOptions(sp: Pick<URLSearchParams, "get" | "getAll">, at: Date = new Date()): ReportOptions {
  const year = parseSchoolYear(sp.get("year") ?? undefined, at)
  const classId = parseRouteId(sp.get("class"))
  const picked = new Set(sp.getAll("col"))
  const columns = sp.get("applied") === "1" ? REPORT_COLUMNS.filter((c) => picked.has(c)) : DEFAULT_COLUMNS
  return { year, classId, columns }
}

/** The query string for these options (export links and the picker share it). */
export function reportQuery(o: ReportOptions): string {
  const q = new URLSearchParams({ year: String(o.year) })
  if (o.classId !== null) q.set("class", String(o.classId))
  q.set("applied", "1")
  for (const c of o.columns) q.append("col", c)
  return q.toString()
}

export type ReportClass = { id: number; name: string; level: number; location: string }
export type ReportChild = { personId: number; firstName: string; lastName: string; familyName: string; classId: number }
/** One attendance mark, with the class whose roll it is on. */
export type ReportMark = { personId: number; classId: number; status: AttendanceStatus }
/** `totalMarks` / `score` are Decimal(10,2) strings. */
export type ReportExam = { id: number; classId: number; name: string; date: Date; totalMarks: string }
export type ReportResult = { examId: number; personId: number; score: string }

/** Everything a report needs for one school year (already scoped to the picked class, if any). */
export type ReportInput = {
  year: number
  classes: ReportClass[]
  children: ReportChild[]
  marks: ReportMark[]
  exams: ReportExam[]
  results: ReportResult[]
}

/** A cell: text, a number (counts, scores, percentages) or blank. */
export type ReportCell = string | number | null

export type ReportTable = { title: string; subtitle: string; headers: string[]; rows: ReportCell[][] }

/** A validated decimal string as integer hundredths ("40.25" -> 4025); 0 for anything else. */
function hundredths(s: string): number {
  if (!MONEY_DECIMAL_RE.test(s)) return 0
  const [whole, frac = ""] = s.split(".")
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(frac.padEnd(2, "0"), 10)
}

/** A decimal string as a display number with trailing zeros dropped ("20.00" -> 20, "50.50" -> 50.5). */
function decimal(s: string): number {
  return hundredths(s) / 100
}

/** part/whole as a percentage rounded to 1 dp; null when whole is 0 (nothing to measure). */
function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10
}

/** "Kindy" or "Kindy (North)" when the class has a location. */
export function classLabel(c: Pick<ReportClass, "name" | "location">): string {
  return c.location ? `${c.name} (${c.location})` : c.name
}

/** Attendance counts per child, keyed `${classId}:${personId}` so marks from another class don't count. */
function attendanceByChild(marks: ReportMark[]): Map<string, { present: number; late: number; absent: number }> {
  const out = new Map<string, { present: number; late: number; absent: number }>()
  for (const m of marks) {
    const k = `${m.classId}:${m.personId}`
    const c = out.get(k) ?? { present: 0, late: 0, absent: 0 }
    if (m.status === "PRESENT") c.present++
    else if (m.status === "LATE") c.late++
    else c.absent++
    out.set(k, c)
  }
  return out
}

/**
 * Build the report table. Rows: one per enrolled child, ordered by class
 * (location, level, name) then surname. Attendance: present/late/absent counts
 * on the child's class roll and attendance % = (present + late) / marked.
 * Marks: one column per exam when a single class is picked (exams differ per
 * class), else "Exams marked"; then marks % = scores / totals of the exams the
 * child has a score in (unmarked exams don't count against them).
 * @param input loaded year data
 * @param opts the picked options
 * @param generated date label for the subtitle (Sydney DD/MM/YYYY)
 */
export function buildReport(input: ReportInput, opts: ReportOptions, generated: string): ReportTable {
  const cols = new Set(opts.columns)
  // A picked class narrows the report even if the input holds more classes.
  const classes = input.classes.filter((c) => opts.classId === null || c.id === opts.classId).sort(
    (a, b) => a.location.localeCompare(b.location) || a.level - b.level || a.name.localeCompare(b.name),
  )
  const classOrder = new Map(classes.map((c, i) => [c.id, i]))
  const single = opts.classId === null ? null : classes[0] ?? null
  const children = input.children
    .filter((c) => classOrder.has(c.classId))
    .sort(
      (a, b) =>
        classOrder.get(a.classId)! - classOrder.get(b.classId)! ||
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName),
    )

  const exams = [...input.exams].sort((a, b) => a.date.getTime() - b.date.getTime() || a.name.localeCompare(b.name))
  const scores = new Map(input.results.map((r) => [`${r.examId}:${r.personId}`, r.score]))
  const attendance = attendanceByChild(input.marks)
  const singleExams = single ? exams.filter((e) => e.classId === single.id) : []

  const headers = ["Child"]
  if (!single) headers.push("Class")
  if (cols.has("family")) headers.push("Family")
  if (cols.has("attendance")) headers.push("Present", "Late", "Absent", "Attendance %")
  if (cols.has("marks")) {
    if (single) headers.push(...singleExams.map((e) => `${e.name} (/${decimal(e.totalMarks)})`))
    else headers.push("Exams marked")
    headers.push("Marks %")
  }

  const classById = new Map(classes.map((c) => [c.id, c]))
  const rows = children.map((ch) => {
    const row: ReportCell[] = [`${ch.lastName}, ${ch.firstName}`]
    if (!single) row.push(classLabel(classById.get(ch.classId)!))
    if (cols.has("family")) row.push(ch.familyName)
    if (cols.has("attendance")) {
      const a = attendance.get(`${ch.classId}:${ch.personId}`) ?? { present: 0, late: 0, absent: 0 }
      row.push(a.present, a.late, a.absent, percent(a.present + a.late, a.present + a.late + a.absent))
    }
    if (cols.has("marks")) {
      let got = 0
      let out = 0
      let marked = 0
      for (const e of exams) {
        if (e.classId !== ch.classId) continue
        const s = scores.get(`${e.id}:${ch.personId}`)
        if (s === undefined) continue
        got += hundredths(s)
        out += hundredths(e.totalMarks)
        marked++
      }
      if (single) {
        for (const e of singleExams) {
          const s = scores.get(`${e.id}:${ch.personId}`)
          row.push(s === undefined ? null : decimal(s))
        }
      } else row.push(marked)
      row.push(percent(got, out))
    }
    return row
  })

  const n = rows.length
  return {
    title: `Sunday School report: ${single ? classLabel(single) : "all classes"}, ${opts.year}`,
    subtitle: `${n} ${n === 1 ? "child" : "children"} · generated ${generated}`,
    headers,
    rows,
  }
}

/** A cell as display text: blank = "–", numbers under a "%" header get a "%" suffix. */
export function formatCell(header: string, cell: ReportCell): string {
  if (cell === null || cell === "") return "–"
  if (typeof cell === "number" && header.endsWith("%")) return `${cell}%`
  return String(cell)
}
