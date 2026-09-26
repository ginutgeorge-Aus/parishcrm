import { currentFYYear, fyDateRange, parseFyYearParam } from "@/lib/fiscalYear"

describe("currentFYYear", () => {
  it("returns the calendar year for Jul–Dec", () => {
    expect(currentFYYear(new Date("2025-07-01T12:00:00Z"))).toBe(2025)
    expect(currentFYYear(new Date("2025-12-31T12:00:00Z"))).toBe(2025)
  })

  it("returns prior calendar year for Jan–Jun", () => {
    expect(currentFYYear(new Date("2026-01-01T12:00:00Z"))).toBe(2025)
    expect(currentFYYear(new Date("2026-06-30T00:00:00Z"))).toBe(2025)
  })

  it("uses the Sydney June/July boundary, not the server's UTC clock", () => {
    // 2025-06-30 20:00 UTC is already 2025-07-01 in Sydney → new FY.
    expect(currentFYYear(new Date("2025-06-30T20:00:00Z"))).toBe(2025)
    // 2025-06-30 13:00 UTC is still 2025-06-30 23:00 in Sydney → old FY.
    expect(currentFYYear(new Date("2025-06-30T13:00:00Z"))).toBe(2024)
  })
})

describe("fyDateRange", () => {
  it("returns Jul 1 start and exclusive Jul 1 (next year) end", () => {
    const { start, end } = fyDateRange(2025)
    expect(start).toEqual(new Date("2025-07-01"))
    expect(end).toEqual(new Date("2026-07-01"))
  })
})

describe("parseFyYearParam", () => {
  it("defaults to the current FY when absent", () => {
    expect(parseFyYearParam(null, 2025)).toBe(2025)
    expect(parseFyYearParam(undefined, 2025)).toBe(2025)
  })

  it.each([["2000", 2000], ["2024", 2024], ["2035", 2035]])("accepts %p", (raw, expected) => {
    expect(parseFyYearParam(raw, 2025)).toBe(expected)
  })

  it.each(["", "1999", "2036", "2025abc", "20.5", "abc", "-2025"])("rejects %p", (raw) => {
    expect(parseFyYearParam(raw, 2025)).toBeNull()
  })
})
