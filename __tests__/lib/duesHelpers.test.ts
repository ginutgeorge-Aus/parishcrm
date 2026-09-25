import { completedMonthsInFY, computeFamilyDues } from "@/lib/reports/duesHelpers"

// FY 2025 = 1 Jul 2025 → 30 Jun 2026 (12 months: Jul..Jun).
// asOf instants are evaluated against the Sydney wall clock; a month is
// "completed" only once it has fully ended ("due only at end of month").

describe("completedMonthsInFY", () => {
  it("counts all 12 months once the FY is fully over", () => {
    expect(completedMonthsInFY(2025, null, new Date("2026-08-01T12:00:00Z"))).toBe(12)
  })

  it("excludes the current in-progress month", () => {
    // Mid-January 2026 → Jul..Dec 2025 completed (6), January still running.
    expect(completedMonthsInFY(2025, null, new Date("2026-01-15T12:00:00Z"))).toBe(6)
  })

  it("counts zero before the first month of the FY has ended", () => {
    // Mid-July 2025 → July not yet completed.
    expect(completedMonthsInFY(2025, null, new Date("2025-07-15T12:00:00Z"))).toBe(0)
  })

  it("pro-rates from the family's join month (inclusive)", () => {
    const joined = new Date("2025-10-01T00:00:00Z")
    // Joined Oct → Oct, Nov, Dec completed by mid-January.
    expect(completedMonthsInFY(2025, joined, new Date("2026-01-15T12:00:00Z"))).toBe(3)
  })

  it("ignores a join date before the FY (full FY applies)", () => {
    const joined = new Date("2020-03-01T00:00:00Z")
    expect(completedMonthsInFY(2025, joined, new Date("2026-08-01T12:00:00Z"))).toBe(12)
  })

  it("returns zero for a family that joins after the FY ends", () => {
    const joined = new Date("2026-08-01T00:00:00Z")
    expect(completedMonthsInFY(2025, joined, new Date("2026-09-01T12:00:00Z"))).toBe(0)
  })

  it("returns zero when asOf is before the FY starts", () => {
    expect(completedMonthsInFY(2025, null, new Date("2025-05-15T12:00:00Z"))).toBe(0)
  })
})

describe("computeFamilyDues", () => {
  const asOf = new Date("2026-01-15T12:00:00Z") // 6 completed months in FY 2025

  it("computes expected = completed months × rate, due = expected − paid", () => {
    const r = computeFamilyDues({ monthlyDues: 60, joinedDate: null, paidTotal: 200 }, 2025, asOf)
    expect(r.months).toBe(6)
    expect(r.expected).toBe(360)
    expect(r.paid).toBe(200)
    expect(r.due).toBe(160)
  })

  it("never reports a negative due when overpaid", () => {
    const r = computeFamilyDues({ monthlyDues: 60, joinedDate: null, paidTotal: 500 }, 2025, asOf)
    expect(r.expected).toBe(360)
    expect(r.due).toBe(0)
  })

  it("treats a null rate as no obligation", () => {
    const r = computeFamilyDues({ monthlyDues: null, joinedDate: null, paidTotal: 0 }, 2025, asOf)
    expect(r.expected).toBe(0)
    expect(r.due).toBe(0)
  })

  it("rounds to cents (no float drift)", () => {
    const r = computeFamilyDues({ monthlyDues: 80.1, joinedDate: null, paidTotal: 0 }, 2025, asOf)
    expect(r.expected).toBe(480.6)
  })
})
