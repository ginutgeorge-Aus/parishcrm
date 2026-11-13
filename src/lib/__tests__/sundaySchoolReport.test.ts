import {
  buildReport,
  parseReportOptions,
  reportQuery,
  type ReportInput,
  type ReportOptions,
} from "@/lib/sundaySchoolReport"

const NOW = new Date("2026-06-01T00:00:00Z")

/** Build URLSearchParams from a query string. */
const qs = (s: string) => new URLSearchParams(s)

describe("parseReportOptions", () => {
  it("defaults: current year, all classes, attendance + marks", () => {
    const o = parseReportOptions(qs(""), NOW)
    expect(o).toEqual({ year: 2026, classId: null, columns: ["attendance", "marks"] })
  })

  it("reads year, class and the exact ticked columns once applied", () => {
    const o = parseReportOptions(qs("year=2025&class=7&applied=1&col=family&col=marks"), NOW)
    expect(o).toEqual({ year: 2025, classId: 7, columns: ["family", "marks"] })
  })

  it("applied with nothing ticked = name only", () => {
    expect(parseReportOptions(qs("applied=1"), NOW).columns).toEqual([])
  })

  it("ignores unknown columns, duplicates, bad class ids and bad years", () => {
    const o = parseReportOptions(qs("year=1900&class=abc&applied=1&col=evil&col=marks&col=marks"), NOW)
    expect(o).toEqual({ year: 2026, classId: null, columns: ["marks"] })
    expect(parseReportOptions(qs("class=0"), NOW).classId).toBeNull()
  })

  it("round-trips through reportQuery", () => {
    const o: ReportOptions = { year: 2025, classId: 3, columns: ["family", "attendance"] }
    expect(parseReportOptions(qs(reportQuery(o)), NOW)).toEqual(o)
    expect(reportQuery({ year: 2025, classId: null, columns: [] })).toBe("year=2025&applied=1")
  })
})

const input: ReportInput = {
  year: 2026,
  classes: [
    { id: 1, name: "Kindy", level: 0, location: "" },
    { id: 2, name: "Year 1", level: 1, location: "" },
  ],
  children: [
    { personId: 10, firstName: "Ann", lastName: "Zed", familyName: "Zed", classId: 1 },
    { personId: 11, firstName: "Bob", lastName: "Abe", familyName: "", classId: 1 },
    { personId: 12, firstName: "Cat", lastName: "Moe", familyName: "Moe", classId: 2 },
  ],
  marks: [
    { personId: 10, classId: 1, status: "PRESENT" },
    { personId: 10, classId: 1, status: "LATE" },
    { personId: 10, classId: 1, status: "ABSENT" },
    { personId: 10, classId: 1, status: "PRESENT" },
    // A mark from another class (child moved) does not count for this class.
    { personId: 12, classId: 1, status: "PRESENT" },
    { personId: 12, classId: 2, status: "ABSENT" },
  ],
  exams: [
    { id: 100, classId: 1, name: "Term 1", date: new Date("2026-03-01T00:00:00Z"), totalMarks: "20" },
    { id: 101, classId: 1, name: "Term 2", date: new Date("2026-05-01T00:00:00Z"), totalMarks: "50.5" },
    { id: 200, classId: 2, name: "Quiz", date: new Date("2026-04-01T00:00:00Z"), totalMarks: "10" },
  ],
  results: [
    { examId: 100, personId: 10, score: "15" },
    { examId: 101, personId: 10, score: "40.25" },
    { examId: 100, personId: 11, score: "0" },
    { examId: 200, personId: 12, score: "10" },
  ],
}

describe("buildReport", () => {
  it("one class: per-exam columns, attendance counts and %, sorted by surname", () => {
    const t = buildReport(input, { year: 2026, classId: 1, columns: ["attendance", "marks"] }, "1/06/2026")
    expect(t.title).toBe("Sunday School report: Kindy, 2026")
    expect(t.subtitle).toBe("2 children · generated 1/06/2026")
    expect(t.headers).toEqual([
      "Child", "Present", "Late", "Absent", "Attendance %", "Term 1 (/20)", "Term 2 (/50.5)", "Marks %",
    ])
    expect(t.rows).toEqual([
      ["Abe, Bob", 0, 0, 0, null, 0, null, 0],
      // (2 present + 1 late) / 4 marked = 75%; (15 + 40.25) / 70.5 = 78.4%
      ["Zed, Ann", 2, 1, 1, 75, 15, 40.25, 78.4],
    ])
  })

  it("all classes: class column, no per-exam columns, ordered by class", () => {
    const t = buildReport(input, { year: 2026, classId: null, columns: ["family", "marks"] }, "x")
    expect(t.title).toBe("Sunday School report: all classes, 2026")
    expect(t.headers).toEqual(["Child", "Class", "Family", "Exams marked", "Marks %"])
    expect(t.rows).toEqual([
      ["Abe, Bob", "Kindy", "", 1, 0],
      ["Zed, Ann", "Kindy", "Zed", 2, 78.4],
      ["Moe, Cat", "Year 1", "Moe", 1, 100],
    ])
  })

  it("name-only report and an empty class", () => {
    const t = buildReport({ ...input, children: [] }, { year: 2026, classId: 2, columns: [] }, "x")
    expect(t.headers).toEqual(["Child"])
    expect(t.rows).toEqual([])
    expect(t.subtitle).toBe("0 children · generated x")
  })

  it("shows the location beside the class name when classes have one", () => {
    const t = buildReport(
      { ...input, classes: [{ id: 1, name: "Kindy", level: 0, location: "North" }] },
      { year: 2026, classId: null, columns: [] },
      "x",
    )
    expect(t.rows[0]).toEqual(["Abe, Bob", "Kindy (North)"])
    expect(t.rows).toHaveLength(2)
  })
})
