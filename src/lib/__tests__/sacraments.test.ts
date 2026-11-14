import { SacramentType } from "@/lib/generated/prisma/enums"
import {
  personNameWhere,
  SACRAMENT_PREFIX,
  SacramentCreateSchema,
  SacramentFieldsSchema,
  checkSacramentRules,
  formatRegisterNo,
  type SacramentFields,
} from "../sacraments"

const TODAY = "2026-11-14"

/** Parsed editable fields with sensible defaults, overridable per test. */
function fields(over: Partial<SacramentFields> = {}): SacramentFields {
  return {
    date: "2026-03-01",
    place: "Parish church",
    ministerName: null,
    spouseId: null,
    spouseName: null,
    godparents: null,
    notes: null,
    ...over,
  }
}

describe("formatRegisterNo", () => {
  it("pads the sequence to three digits", () => {
    expect(formatRegisterNo(SacramentType.BAPTISM, 2026, 14)).toBe("BAP-2026-014")
    expect(formatRegisterNo(SacramentType.MARRIAGE, 2025, 1)).toBe("MAR-2025-001")
  })
  it("keeps every digit past 999", () => {
    expect(formatRegisterNo(SacramentType.CONFIRMATION, 2026, 1000)).toBe("CON-2026-1000")
  })
  it("has a distinct prefix per rite", () => {
    const prefixes = Object.values(SACRAMENT_PREFIX)
    expect(new Set(prefixes).size).toBe(Object.values(SacramentType).length)
  })
})

describe("SacramentFieldsSchema", () => {
  it("trims and nulls blank optional text", () => {
    const r = SacramentFieldsSchema.parse({ date: "2026-01-05", place: "  St Mark  ", ministerName: "  ", notes: "" })
    expect(r).toMatchObject({ place: "St Mark", ministerName: null, notes: null, spouseId: null })
  })
  it("rejects an impossible date", () => {
    const r = SacramentFieldsSchema.safeParse({ date: "2026-02-30", place: "x" })
    expect(r.success).toBe(false)
  })
  it("requires a place", () => {
    const r = SacramentFieldsSchema.safeParse({ date: "2026-01-05", place: "  " })
    expect(r.success).toBe(false)
  })
  it("caps notes length", () => {
    const r = SacramentFieldsSchema.safeParse({ date: "2026-01-05", place: "x", notes: "a".repeat(2001) })
    expect(r.success).toBe(false)
  })
  it.each(["1.5", "1e3", "0x10", "5.0", "0", "2147483648"])("rejects spouse id %s", (spouseId) => {
    const r = SacramentFieldsSchema.safeParse({ date: "2026-01-05", place: "x", spouseId })
    expect(r.success).toBe(false)
  })
  it("measures the length cap after trimming", () => {
    const r = SacramentFieldsSchema.parse({ date: "2026-01-05", place: "x", notes: `${"a".repeat(2000)}\n\n\n` })
    expect(r.notes).toHaveLength(2000)
  })
})

describe("SacramentCreateSchema", () => {
  it("parses rite and person", () => {
    const r = SacramentCreateSchema.parse({ type: "BAPTISM", personId: "7", date: "2026-01-05", place: "x" })
    expect(r).toMatchObject({ type: "BAPTISM", personId: 7 })
  })
  it("rejects an unknown rite", () => {
    const r = SacramentCreateSchema.safeParse({ type: "ORDINATION", personId: "7", date: "2026-01-05", place: "x" })
    expect(r.success).toBe(false)
  })
  it("rejects a person id in exponent form", () => {
    const r = SacramentCreateSchema.safeParse({ type: "BAPTISM", personId: "1e3", date: "2026-01-05", place: "x" })
    expect(r.success).toBe(false)
  })
  it("rejects a missing person", () => {
    const r = SacramentCreateSchema.safeParse({ type: "BAPTISM", personId: "", date: "2026-01-05", place: "x" })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe("Choose a person.")
  })
})

describe("checkSacramentRules", () => {
  it("accepts a plain baptism", () => {
    expect(checkSacramentRules(SacramentType.BAPTISM, 1, fields(), TODAY)).toBeNull()
  })
  it("accepts today but rejects tomorrow", () => {
    expect(checkSacramentRules(SacramentType.BAPTISM, 1, fields({ date: TODAY }), TODAY)).toBeNull()
    expect(checkSacramentRules(SacramentType.BAPTISM, 1, fields({ date: "2026-11-15" }), TODAY)).toMatch(/future/)
  })
  it("rejects a date before 1800", () => {
    expect(checkSacramentRules(SacramentType.BAPTISM, 1, fields({ date: "1799-12-31" }), TODAY)).toMatch(/1800/)
  })
  it("rejects a spouse on a non-marriage rite", () => {
    expect(checkSacramentRules(SacramentType.BAPTISM, 1, fields({ spouseName: "X" }), TODAY)).toMatch(/marriage/)
    expect(checkSacramentRules(SacramentType.FIRST_COMMUNION, 1, fields({ spouseId: 2 }), TODAY)).toMatch(/marriage/)
  })
  it("requires exactly one spouse form on a marriage", () => {
    expect(checkSacramentRules(SacramentType.MARRIAGE, 1, fields(), TODAY)).toMatch(/spouse/)
    expect(checkSacramentRules(SacramentType.MARRIAGE, 1, fields({ spouseId: 2, spouseName: "X" }), TODAY)).toMatch(/not both/)
    expect(checkSacramentRules(SacramentType.MARRIAGE, 1, fields({ spouseId: 2 }), TODAY)).toBeNull()
    expect(checkSacramentRules(SacramentType.MARRIAGE, 1, fields({ spouseName: "Outside Parish" }), TODAY)).toBeNull()
  })
  it("rejects marrying oneself", () => {
    expect(checkSacramentRules(SacramentType.MARRIAGE, 1, fields({ spouseId: 1 }), TODAY)).toMatch(/different/)
  })
})

describe("personNameWhere", () => {
  it("returns null for a blank query", () => {
    expect(personNameWhere("")).toBeNull()
    expect(personNameWhere("  \t ")).toBeNull()
  })

  it("ANDs the words, each matching first OR last name, over current people only", () => {
    const where = personNameWhere("  alex   sam ")
    expect(where).toEqual({
      archivedAt: null,
      AND: [
        { OR: [{ firstName: { contains: "alex", mode: "insensitive" } }, { lastName: { contains: "alex", mode: "insensitive" } }] },
        { OR: [{ firstName: { contains: "sam", mode: "insensitive" } }, { lastName: { contains: "sam", mode: "insensitive" } }] },
      ],
    })
  })

  it("uses at most 5 words", () => {
    expect((personNameWhere("a b c d e f g")?.AND as unknown[]).length).toBe(5)
  })
})
