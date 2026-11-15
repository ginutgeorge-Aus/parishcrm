import {
  summariseAttendance,
  mergeAttendance,
  summariseExams,
  mergeExams,
  formatPercent,
  ratePercent,
  beforeEnrolment,
  skippedNote,
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

describe("ratePercent", () => {
  it("never rounds up to 100 while anyone was absent (199/200)", () => {
    expect(ratePercent(199, 200)).toBe(99)
    expect(ratePercent(200, 200)).toBe(100)
  })
  it("never rounds down to 0 while anyone attended (1/300)", () => {
    expect(ratePercent(1, 300)).toBe(1)
    expect(ratePercent(0, 300)).toBe(0)
  })
  it("is null with a zero denominator", () => {
    expect(ratePercent(0, 0)).toBeNull()
  })
})

describe("summariseAttendance null marks", () => {
  it("ignores not-marked (null) entries", () => {
    expect(summariseAttendance(["PRESENT", null, "ABSENT"])).toEqual({
      present: 1, late: 0, absent: 1, marked: 2, attended: 1, rate: 50,
    })
  })
})

describe("beforeEnrolment", () => {
  const enrolled = new Date("2026-03-08T22:00:00Z")
  it("is true only for dates before the enrolment's Sydney day", () => {
    // 22:00Z on 8 Mar is 09:00 on 9 Mar in Sydney (AEDT)
    expect(beforeEnrolment(new Date("2026-03-01T00:00:00Z"), enrolled)).toBe(true)
    expect(beforeEnrolment(new Date("2026-03-08T00:00:00Z"), enrolled)).toBe(true)
    expect(beforeEnrolment(new Date("2026-03-09T00:00:00Z"), enrolled)).toBe(false)
    expect(beforeEnrolment(new Date("2026-03-15T00:00:00Z"), enrolled)).toBe(false)
  })
})

describe("skippedNote", () => {
  it("is null with none skipped, else pluralised", () => {
    expect(skippedNote(summariseExams([{ score: "1", totalMarks: "2" }]))).toBeNull()
    expect(skippedNote(summariseExams([{ score: "1", totalMarks: "0" }]))).toBe("1 result not counted")
    expect(skippedNote(mergeExams([
      summariseExams([{ score: "1", totalMarks: "0" }]),
      summariseExams([{ score: "x", totalMarks: "5" }]),
    ]))).toBe("2 results not counted")
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

describe("summariseExams single-result percent", () => {
  const pct = (score: string, totalMarks: string) => summariseExams([{ score, totalMarks }]).averagePercent
  it("returns the percent, rounded half up", () => {
    expect(pct("7.5", "50.00")).toBe(15)
    expect(pct("50", "50")).toBe(100)
    expect(pct("0", "50")).toBe(0)
    expect(pct("1", "3")).toBe(33)
    expect(pct("2", "3")).toBe(67)
    expect(pct("1", "200")).toBe(1) // 0.5% rounds half up
  })
  it("skips a non-decimal or zero total", () => {
    for (const [s, tm] of [["abc", "50"], ["5", "0"], ["5", "1e3"]]) {
      expect(summariseExams([{ score: s, totalMarks: tm }])).toMatchObject({ results: 0, skipped: 1, averagePercent: null })
    }
  })
})

describe("summariseExams / mergeExams", () => {
  it("averages each result's percent equally", () => {
    const s = summariseExams([{ score: "10", totalMarks: "20" }, { score: "20", totalMarks: "20" }])
    expect(s).toMatchObject({ results: 2, skipped: 0, averagePercent: 75 })
  })
  it("skips invalid results and reports null with none", () => {
    expect(summariseExams([{ score: "x", totalMarks: "20" }, { score: "5", totalMarks: "0" }]))
      .toMatchObject({ results: 0, skipped: 2, averagePercent: null })
  })
  it("merges by weighting every result equally", () => {
    const a = summariseExams([{ score: "10", totalMarks: "10" }])
    const b = summariseExams([{ score: "0", totalMarks: "10" }, { score: "5", totalMarks: "10" }])
    expect(mergeExams([a, b])).toMatchObject({ results: 3, skipped: 0, averagePercent: 50 })
  })
  it("merges exactly: merged summaries equal one pass over all rows", () => {
    const rows = [{ score: "1", totalMarks: "3" }, { score: "2", totalMarks: "3" }, { score: "1", totalMarks: "6" }]
    const whole = summariseExams(rows)
    expect(mergeExams(rows.map((r) => summariseExams([r])))).toEqual(whole)
    expect(whole.ratioSum).toEqual({ num: BigInt(7), den: BigInt(6) }) // 1/3 + 2/3 + 1/6, reduced
    expect(whole.averagePercent).toBe(39) // 7/18 = 38.89%
  })
  it("rounds once over exact ratios, not per result", () => {
    // 2.99/300 = 0.9967% and 0%: exact mean 0.498% -> 0. Rounding each result to
    // basis points first (100bp + 0bp = 0.50% mean) would wrongly show 1%.
    const s = summariseExams([{ score: "2.99", totalMarks: "300" }, { score: "0", totalMarks: "300" }])
    expect(s.averagePercent).toBe(0)
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
  it("treats a negative, fractional or NaN attendance count as 0", () => {
    const s = classStats({
      ...kindy,
      attendance: [
        { personId: 10, status: "PRESENT", count: 3 },
        { personId: 10, status: "ABSENT", count: -2 },
        { personId: 10, status: "LATE", count: 1.5 },
        { personId: 11, status: "ABSENT", count: Number.NaN },
      ],
    })
    expect(s.attendance).toMatchObject({ present: 3, late: 0, absent: 0, marked: 3 })
  })
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
