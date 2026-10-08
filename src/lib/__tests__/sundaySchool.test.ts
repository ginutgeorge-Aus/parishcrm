import { ClassFormSchema, currentSchoolYear, parseSchoolYear, planRollover, MAX_LEVEL } from "@/lib/sundaySchool"

describe("ClassFormSchema", () => {
  it("trims and coerces", () => {
    const r = ClassFormSchema.safeParse({ name: "  Years 1–2 ", level: "1", location: " Hall " })
    expect(r.success && r.data).toEqual({ name: "Years 1–2", level: 1, location: "Hall" })
  })
  it("defaults location to empty string", () => {
    const r = ClassFormSchema.safeParse({ name: "Kindy", level: "0" })
    expect(r.success && r.data.location).toBe("")
  })
  it("rejects empty name, negative or too-high level, long strings", () => {
    expect(ClassFormSchema.safeParse({ name: " ", level: "1" }).success).toBe(false)
    expect(ClassFormSchema.safeParse({ name: "A", level: "-1" }).success).toBe(false)
    expect(ClassFormSchema.safeParse({ name: "A", level: String(MAX_LEVEL + 1) }).success).toBe(false)
    expect(ClassFormSchema.safeParse({ name: "A", level: "1.5" }).success).toBe(false)
    expect(ClassFormSchema.safeParse({ name: "A", level: "" }).success).toBe(false)
    expect(ClassFormSchema.safeParse({ name: "x".repeat(81), level: "1" }).success).toBe(false)
  })
})

describe("currentSchoolYear", () => {
  it("uses the Sydney calendar year (31 Dec 14:00Z is already 1 Jan in Sydney)", () => {
    expect(currentSchoolYear(new Date("2026-12-31T14:00:00Z"))).toBe(2027)
    expect(currentSchoolYear(new Date("2026-06-01T00:00:00Z"))).toBe(2026)
  })
})

describe("parseSchoolYear", () => {
  const at = new Date("2026-06-01T00:00:00Z")
  it("accepts an in-range four-digit year", () => {
    expect(parseSchoolYear("2027", at)).toBe(2027)
  })
  it.each([undefined, "", "abc", "2027x", "1999", "2101", "20270"])("falls back to the current year for %j", (raw) => {
    expect(parseSchoolYear(raw, at)).toBe(2026)
  })
})

describe("planRollover", () => {
  const cls = (id: number, level: number, location = "", kids: number[] = [], teachers: number[] = []) =>
    ({ id, name: `C${id}`, level, location, teacherPersonIds: teachers, childPersonIds: kids })

  it("copies every class with its teachers", () => {
    const plan = planRollover([cls(1, 0, "", [], [7]), cls(2, 1)])
    expect(plan.classes).toEqual([
      { sourceId: 1, name: "C1", level: 0, location: "", teacherPersonIds: [7] },
      { sourceId: 2, name: "C2", level: 1, location: "", teacherPersonIds: [] },
    ])
  })

  it("promotes children to level+1 at the same location", () => {
    const plan = planRollover([cls(1, 0, "North", [10, 11]), cls(2, 1, "North"), cls(3, 1, "South")])
    expect(plan.placements).toEqual([
      { personId: 10, targetSourceId: 2 },
      { personId: 11, targetSourceId: 2 },
    ])
    expect(plan.unplaced).toEqual([])
  })

  it("leaves top-level and ambiguous children unplaced", () => {
    const plan = planRollover([cls(1, 0, "", [10]), cls(2, 1, "", [20]), cls(3, 1, "", [])])
    // level 0 -> two level-1 classes at "" = ambiguous; level 1 -> no level 2 = graduates
    expect(plan.placements).toEqual([])
    expect(plan.unplaced.sort((a, b) => a - b)).toEqual([10, 20])
  })
})
