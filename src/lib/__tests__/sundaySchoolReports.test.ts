/** @jest-environment node */
import {
  attendanceHistoryTable, attendanceSummaryTable, buildReport, examResultsTable, parseYmd, reportToCsv, slugify, validRange,
  type ReportInput,
} from "@/lib/sundaySchoolReports"

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const input: ReportInput = {
  className: "Kindy",
  students: [
    { personId: 1, name: "Ann Adams", enrolledAt: d("2026-01-01") },
    { personId: 2, name: "Ben Late-Joiner", enrolledAt: new Date("2026-03-01T02:00:00Z") },
    { personId: 3, name: "=cmd|calc", enrolledAt: d("2026-01-01") },
  ],
  sessions: [
    { date: d("2026-02-01"), marks: [{ personId: 1, status: "PRESENT" }, { personId: 2, status: "PRESENT" }] },
    { date: d("2026-03-08"), marks: [{ personId: 1, status: "LATE" }, { personId: 2, status: "ABSENT" }] },
    { date: d("2026-03-15"), marks: [{ personId: 1, status: "ABSENT" }] },
  ],
  exams: [
    { id: 1, name: "Term 1", date: d("2026-02-10"), totalMarks: "50.00", results: [{ personId: 1, score: "25.00" }] },
    { id: 2, name: "Term 2", date: d("2026-03-20"), totalMarks: "20", results: [{ personId: 1, score: "20" }, { personId: 2, score: "10" }] },
  ],
}

describe("attendanceSummaryTable", () => {
  const rows = attendanceSummaryTable(input).rows
  it("counts present/late/absent, unmarked and rate via the shared stats", () => {
    expect(rows[0]).toEqual(["Ann Adams", "1", "1", "1", "0", "67%"])
  })
  it("keeps a mark before enrolment; unmarked after enrolment counts as unmarked", () => {
    // Ben: Feb 1 marked (kept though pre-enrolment), Mar 8 absent, Mar 15 unmarked
    expect(rows[1]).toEqual(["Ben Late-Joiner", "1", "0", "1", "1", "50%"])
  })
  it("shows a dash rate when nothing is marked", () => {
    expect(rows[2]).toEqual(["=cmd|calc", "0", "0", "0", "3", "—"])
  })
  it("drops unmarked rolls before enrolment", () => {
    const late: ReportInput = { ...input, students: [{ personId: 9, name: "Zed", enrolledAt: d("2026-03-10") }] }
    expect(attendanceSummaryTable(late).rows[0]).toEqual(["Zed", "0", "0", "0", "1", "—"])
  })
})

describe("attendanceHistoryTable", () => {
  it("one row per student per roll, unmarked as Not marked", () => {
    const t = attendanceHistoryTable(input)
    expect(t.headers).toEqual(["Date", "Student", "Status"])
    expect(t.rows).toContainEqual(["15/03/2026", "Ben Late-Joiner", "Not marked"])
    expect(t.rows).toContainEqual(["08/03/2026", "Ann Adams", "Late"])
    expect(t.rows).toHaveLength(9)
  })
})

describe("examResultsTable", () => {
  it("grid of score / total with average, blank when unscored", () => {
    const t = examResultsTable(input)
    expect(t.headers).toEqual(["Student", "Term 1 (10/02/2026) /50.00", "Term 2 (20/03/2026) /20", "Average"])
    expect(t.rows[0]).toEqual(["Ann Adams", "25.00 / 50.00", "20 / 20", "75%"])
    expect(t.rows[1]).toEqual(["Ben Late-Joiner", "", "10 / 20", "50%"])
    expect(t.rows[2]).toEqual(["=cmd|calc", "", "", "—"])
  })
  it("has no exam columns when none are live in range", () => {
    expect(examResultsTable({ ...input, exams: [] }).headers).toEqual(["Student", "Average"])
  })
})

describe("reportToCsv", () => {
  it("neutralises formula-looking student names", () => {
    const csv = reportToCsv(buildReport("summary", input))
    expect(csv.split("\n")[0]).toBe("Student,Present,Late,Absent,Unmarked,Attendance rate")
    expect(csv).toContain("'=cmd|calc,0,0,0,3")
    expect(csv).not.toMatch(/^=cmd/m)
  })
})

describe("range helpers", () => {
  it("parseYmd accepts real days only", () => {
    expect(parseYmd("2026-02-28")).toEqual(d("2026-02-28"))
    expect(parseYmd("2026-02-30")).toBeNull()
    expect(parseYmd("26-1-1")).toBeNull()
    expect(parseYmd(null)).toBeNull()
  })
  it("validRange rejects reversed and over-2-year ranges", () => {
    expect(validRange(d("2026-01-01"), d("2026-12-31"))).toBe(true)
    expect(validRange(d("2026-02-01"), d("2026-01-01"))).toBe(false)
    expect(validRange(d("2024-01-01"), d("2026-01-02"))).toBe(false)
  })
  it("slugify is filename safe", () => {
    expect(slugify("Year 1 / Blue!")).toBe("year-1-blue")
    expect(slugify("///")).toBe("class")
  })
})
