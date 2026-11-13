import {
  summariseAttendance,
  mergeAttendance,
  scoreBasisPoints,
  summariseExams,
  mergeExams,
  formatPercent,
  classStats,
  gradeStats,
  type ClassStatsInput,
} from "@/lib/sundaySchoolStats"

describe("summariseAttendance", () => {
  it("counts each status; late counts as attended; rate over marked rows", () => {
    expect(summariseAttendance(["PRESENT", "LATE", "ABSENT", "PRESENT"])).toEqual({
      present: 2, late: 1, absent: 1, marked: 4, attended: 3, rate: 75,
    })
  })
  it("rate is null with nothing marked", () => {
    expect(summariseAttendance([]).rate).toBeNull()
  })
  it("rounds the rate to a whole percent", () => {
    expect(summariseAttendance(["PRESENT", "ABSENT", "ABSENT"]).rate).toBe(33)
    expect(summariseAttendance(["PRESENT", "PRESENT", "ABSENT"]).rate).toBe(67)
  })
})

describe("mergeAttendance", () => {
  it("sums counts and recomputes the rate", () => {
    const a = summariseAttendance(["PRESENT", "ABSENT"])
    const b = summariseAttendance(["LATE", "PRESENT"])
    expect(mergeAttendance([a, b])).toEqual({ present: 2, late: 1, absent: 1, marked: 4, attended: 3, rate: 75 })
  })
  it("empty list = nothing marked", () => {
    expect(mergeAttendance([])).toEqual({ present: 0, late: 0, absent: 0, marked: 0, attended: 0, rate: null })
  })
})

describe("scoreBasisPoints", () => {
  it("returns percent x100, rounded half up", () => {
    expect(scoreBasisPoints("7.5", "50.00")).toBe(1500)
    expect(scoreBasisPoints("50", "50")).toBe(10000)
    expect(scoreBasisPoints("0", "50")).toBe(0)
    expect(scoreBasisPoints("1", "3")).toBe(3333)
    expect(scoreBasisPoints("2", "3")).toBe(6667)
  })
  it("returns null for a non-decimal or zero total", () => {
    expect(scoreBasisPoints("abc", "50")).toBeNull()
    expect(scoreBasisPoints("5", "0")).toBeNull()
    expect(scoreBasisPoints("5", "1e3")).toBeNull()
  })
})

describe("summariseExams / mergeExams", () => {
  it("averages each result's percent equally", () => {
    const s = summariseExams([{ score: "10", totalMarks: "20" }, { score: "20", totalMarks: "20" }])
    expect(s).toEqual({ results: 2, totalBp: 15000, averagePercent: 75 })
  })
  it("skips invalid results and reports null with none", () => {
    expect(summariseExams([{ score: "x", totalMarks: "20" }])).toEqual({ results: 0, totalBp: 0, averagePercent: null })
  })
  it("merges by weighting every result equally", () => {
    const a = summariseExams([{ score: "10", totalMarks: "10" }])
    const b = summariseExams([{ score: "0", totalMarks: "10" }, { score: "5", totalMarks: "10" }])
    expect(mergeExams([a, b])).toEqual({ results: 3, totalBp: 15000, averagePercent: 50 })
  })
})

describe("formatPercent", () => {
  it("shows a dash for null", () => {
    expect(formatPercent(null)).toBe("—")
    expect(formatPercent(0)).toBe("0%")
    expect(formatPercent(85)).toBe("85%")
  })
})

const kindy: ClassStatsInput = {
  id: 1, name: "Kindy", level: 0, location: "",
  students: [{ personId: 10, name: "Ann Adams" }, { personId: 11, name: "Ben Brown" }],
  attendance: [
    { personId: 10, status: "PRESENT" },
    { personId: 10, status: "ABSENT" },
    { personId: 11, status: "LATE" },
    // moved-out child: ignored
    { personId: 99, status: "ABSENT" },
  ],
  exams: [
    { totalMarks: "20", results: [{ personId: 10, score: "10" }, { personId: 99, score: "0" }] },
    { totalMarks: "10", results: [{ personId: 10, score: "10" }, { personId: 11, score: "5" }] },
  ],
}

describe("classStats", () => {
  it("builds per-student and class totals over enrolled children only", () => {
    const s = classStats(kindy)
    expect(s.enrolled).toBe(2)
    expect(s.attendance).toMatchObject({ marked: 3, attended: 2, rate: 67 })
    expect(s.exams).toMatchObject({ results: 3, averagePercent: 67 })
    expect(s.students).toEqual([
      { personId: 10, name: "Ann Adams", attendance: expect.objectContaining({ marked: 2, rate: 50 }), exams: expect.objectContaining({ results: 2, averagePercent: 75 }) },
      { personId: 11, name: "Ben Brown", attendance: expect.objectContaining({ marked: 1, rate: 100 }), exams: expect.objectContaining({ results: 1, averagePercent: 50 }) },
    ])
  })
  it("a class with no rolls or exams has null rates", () => {
    const s = classStats({ ...kindy, attendance: [], exams: [] })
    expect(s.attendance.rate).toBeNull()
    expect(s.exams.averagePercent).toBeNull()
    expect(s.students[0].attendance.rate).toBeNull()
  })
})

describe("gradeStats", () => {
  it("groups classes by level, sorted ascending, with combined totals", () => {
    const k2 = classStats({ ...kindy, id: 2, name: "Kindy B", location: "North", students: [{ personId: 12, name: "Cat" }], attendance: [{ personId: 12, status: "PRESENT" }], exams: [] })
    const y3 = classStats({ ...kindy, id: 3, name: "Year 3", level: 3, students: [], attendance: [], exams: [] })
    const g = gradeStats([y3, classStats(kindy), k2])
    expect(g.map((x) => x.level)).toEqual([0, 3])
    expect(g[0]).toMatchObject({ level: 0, classCount: 2, enrolled: 3 })
    expect(g[0].attendance).toMatchObject({ marked: 4, attended: 3, rate: 75 })
    expect(g[0].exams).toMatchObject({ results: 3, averagePercent: 67 })
    expect(g[1]).toMatchObject({ level: 3, classCount: 1, enrolled: 0 })
    expect(g[1].attendance.rate).toBeNull()
  })
})
