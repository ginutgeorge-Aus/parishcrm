import {
  buildMonthly,
  buildWeekly,
  buildYearOverYear,
  latestWithDelta,
  weekStartYMD,
  type HeadcountRow,
} from "../attendance"

const row = (
  date: string,
  serviceTypeId: number,
  adults: number,
  children: number,
): HeadcountRow => ({ date, serviceTypeId, adults, children })

describe("weekStartYMD", () => {
  it("returns the Monday of the ISO week", () => {
    expect(weekStartYMD("2027-01-01")).toBe("2026-12-28")
    expect(weekStartYMD("2026-11-09")).toBe("2026-11-09") // Monday
    expect(weekStartYMD("2026-11-15")).toBe("2026-11-09") // Sunday
  })
})

describe("buildWeekly", () => {
  it("sums multiple service types in one week", () => {
    const rows = [row("2026-11-08", 1, 50, 10), row("2026-11-04", 2, 20, 5)]
    const pts = buildWeekly(rows, "2026-11-02", "2026-11-08")
    expect(pts).toHaveLength(1)
    expect(pts[0]).toMatchObject({ key: "2026-11-02", adults: 70, children: 15 })
  })

  it("emits null for a week with no rows (gap, not zero)", () => {
    const pts = buildWeekly([row("2026-11-01", 1, 5, 1)], "2026-10-26", "2026-11-09")
    expect(pts.map((p) => p.key)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"])
    expect(pts[0].adults).toBe(5)
    expect(pts[1]).toMatchObject({ adults: null, children: null })
    expect(pts[2]).toMatchObject({ adults: null, children: null })
  })

  it("plots a recorded 0/0 as 0, not null", () => {
    const pts = buildWeekly([row("2026-11-08", 1, 0, 0)], "2026-11-02", "2026-11-08")
    expect(pts[0].adults).toBe(0)
    expect(pts[0].children).toBe(0)
  })

  it("filters by serviceTypeId", () => {
    const rows = [row("2026-11-08", 1, 50, 10), row("2026-11-04", 2, 20, 5)]
    const pts = buildWeekly(rows, "2026-11-02", "2026-11-08", 2)
    expect(pts[0]).toMatchObject({ adults: 20, children: 5 })
  })

  it("keeps the year boundary week as a single bucket", () => {
    const rows = [row("2026-12-28", 1, 10, 1), row("2027-01-03", 1, 20, 2)]
    const pts = buildWeekly(rows, "2026-12-21", "2027-01-04")
    expect(pts.map((p) => p.key)).toEqual(["2026-12-21", "2026-12-28", "2027-01-04"])
    expect(pts[1]).toMatchObject({ adults: 30, children: 3 })
    expect(pts[2].adults).toBeNull()
  })
})

describe("buildMonthly", () => {
  it("emits one point per month with gaps as null and keys YYYY-MM", () => {
    const rows = [row("2026-09-06", 1, 10, 2), row("2026-09-13", 1, 12, 3), row("2026-11-01", 1, 7, 0)]
    const pts = buildMonthly(rows, "2026-09", "2026-11")
    expect(pts.map((p) => p.key)).toEqual(["2026-09", "2026-10", "2026-11"])
    expect(pts[0]).toMatchObject({ adults: 22, children: 5 })
    expect(pts[1]).toMatchObject({ adults: null, children: null })
    expect(pts[2]).toMatchObject({ adults: 7, children: 0 })
  })

  it("crosses a year boundary", () => {
    const pts = buildMonthly([], "2026-11", "2027-02")
    expect(pts.map((p) => p.key)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"])
  })
})

describe("buildYearOverYear", () => {
  it("compares ISO weeks and leaves week 53 as a gap when last year has none", () => {
    // 2026 has 53 ISO weeks; 2025 has 52. Asking for 2027: last year = 2026.
    // Asking for 2026: last year (2025) has no week 53.
    const rows = [row("2025-12-28", 1, 10, 0), row("2026-12-28", 1, 40, 4)]
    const out = buildYearOverYear(rows, 2026, "week")
    expect(out).toHaveLength(53)
    const w53 = out.find((p) => p.period === 53)!
    expect(w53.thisYear).toBe(44)
    expect(w53.lastYear).toBeNull()
    const w52 = out.find((p) => p.period === 52)!
    expect(w52.lastYear).toBe(10)
    expect(w52.thisYear).toBeNull()
  })

  it("compares months and uses null for months without rows", () => {
    const rows = [row("2025-03-02", 1, 10, 5), row("2026-03-01", 1, 20, 6)]
    const out = buildYearOverYear(rows, 2026, "month")
    expect(out).toHaveLength(12)
    expect(out[2]).toEqual({ period: 3, thisYear: 26, lastYear: 15 })
    expect(out[0]).toEqual({ period: 1, thisYear: null, lastYear: null })
  })

  it("counts a recorded 0 as 0 (not a gap)", () => {
    const out = buildYearOverYear([row("2026-03-01", 1, 0, 0)], 2026, "month")
    expect(out[2].thisYear).toBe(0)
  })

  it("filters by serviceTypeId", () => {
    const rows = [row("2026-03-01", 1, 10, 0), row("2026-03-08", 2, 5, 0)]
    expect(buildYearOverYear(rows, 2026, "month", 2)[2].thisYear).toBe(5)
  })
})

describe("latestWithDelta", () => {
  it("returns null for no rows", () => {
    expect(latestWithDelta([])).toBeNull()
  })

  it("picks the latest by date and the same type exactly 7 days earlier", () => {
    const rows = [
      row("2026-11-01", 1, 40, 10),
      row("2026-11-08", 1, 50, 12),
      row("2026-11-08", 2, 5, 1),
      row("2026-11-01", 2, 99, 99),
    ]
    const out = latestWithDelta(rows)!
    // Same-date tie: lowest serviceTypeId wins, so the result is deterministic.
    expect(out.date).toBe("2026-11-08")
    expect(out.serviceTypeId).toBe(1)
    expect(out.previousTotal).toBe(50)
  })

  it("has previousTotal null when no row 7 days earlier", () => {
    const rows = [row("2026-11-08", 1, 50, 12), row("2026-10-25", 1, 40, 10)]
    expect(latestWithDelta(rows)).toEqual({
      date: "2026-11-08",
      serviceTypeId: 1,
      adults: 50,
      children: 12,
      previousTotal: null,
    })
  })

  it("computes previousTotal as adults+children of last week", () => {
    const rows = [row("2026-11-08", 1, 50, 12), row("2026-11-01", 1, 40, 10)]
    expect(latestWithDelta(rows)!.previousTotal).toBe(50)
  })
})
