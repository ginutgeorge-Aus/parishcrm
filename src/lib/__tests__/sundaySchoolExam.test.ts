import { parseScore, ExamFormSchema, isDateInYear } from "@/lib/sundaySchoolExam"

describe("parseScore", () => {
  it("accepts 0 as a real value", () => expect(parseScore("0", "100")).toEqual({ ok: true, value: "0" }))
  it("accepts total and 2dp", () => {
    expect(parseScore("100", "100")).toEqual({ ok: true, value: "100" })
    expect(parseScore("7.55", "100")).toEqual({ ok: true, value: "7.55" })
    expect(parseScore(" 7.5 ", "10")).toEqual({ ok: true, value: "7.5" })
  })
  it("rejects negative, over total, >2dp, non-numeric", () => {
    for (const bad of ["-1", "101", "100.01", "7.555", "abc", "1e2", "1,5", ".5", "5."]) {
      expect(parseScore(bad, "100")).toMatchObject({ ok: false })
    }
  })
  it("strips leading zeros before the too-large check and returns the normalised value", () => {
    expect(parseScore("0000012", "100")).toEqual({ ok: true, value: "12" })
    expect(parseScore("00.5", "100")).toEqual({ ok: true, value: "0.5" })
    expect(parseScore("000", "100")).toEqual({ ok: true, value: "0" })
    expect(parseScore("0001234567", "9999999")).toEqual({ ok: false, error: "Score is too large" })
  })
  it("blank clears", () => {
    expect(parseScore("", "100")).toEqual({ ok: true, clear: true, value: null })
    expect(parseScore("   ", "100")).toEqual({ ok: true, clear: true, value: null })
  })
})

describe("ExamFormSchema / isDateInYear", () => {
  const ok = { name: " Term 1 ", date: "2026-03-01", totalMarks: "50" }
  it("accepts and trims", () => expect(ExamFormSchema.parse(ok).name).toBe("Term 1"))
  it("normalises leading zeros in the total (no false too-large)", () => {
    expect(ExamFormSchema.parse({ ...ok, totalMarks: "0000050" }).totalMarks).toBe("50")
    expect(ExamFormSchema.parse({ ...ok, totalMarks: "000999999.50" }).totalMarks).toBe("999999.50")
    expect(ExamFormSchema.safeParse({ ...ok, totalMarks: "0001234567" }).success).toBe(false)
    expect(ExamFormSchema.safeParse({ ...ok, totalMarks: "000" }).success).toBe(false)
  })
  it("rejects blank name, zero or bad total, bad date", () => {
    expect(ExamFormSchema.safeParse({ ...ok, name: "" }).success).toBe(false)
    expect(ExamFormSchema.safeParse({ ...ok, totalMarks: "0" }).success).toBe(false)
    expect(ExamFormSchema.safeParse({ ...ok, totalMarks: "1.234" }).success).toBe(false)
    expect(ExamFormSchema.safeParse({ ...ok, date: "1/3/2026" }).success).toBe(false)
  })
  it("checks real date in year", () => {
    expect(isDateInYear("2026-03-01", 2026)).toBe(true)
    expect(isDateInYear("2026-02-31", 2026)).toBe(false)
    expect(isDateInYear("2025-12-31", 2026)).toBe(false)
  })
})
