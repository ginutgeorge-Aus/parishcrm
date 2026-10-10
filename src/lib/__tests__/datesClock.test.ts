/** @jest-environment node */
import { sydneyClock, sydneyWeekStartYMD, sydneyMonthKey } from "@/lib/dates"

describe("sydneyClock", () => {
  it("reads Sydney wall-clock in AEST (UTC+10)", () => {
    // 2026-07-01 21:30 UTC = Thu 2026-07-02 07:30 AEST
    expect(sydneyClock(new Date("2026-07-01T21:30:00Z"))).toEqual({ ymd: "2026-07-02", hour: 7, weekday: 4 })
  })
  it("reads Sydney wall-clock in AEDT (UTC+11)", () => {
    // 2026-12-31 20:15 UTC = Fri 2027-01-01 07:15 AEDT
    expect(sydneyClock(new Date("2026-12-31T20:15:00Z"))).toEqual({ ymd: "2027-01-01", hour: 7, weekday: 5 })
  })
  it("reports midnight as hour 0", () => {
    // 2026-07-05 14:00 UTC = Mon 2026-07-06 00:00 AEST
    expect(sydneyClock(new Date("2026-07-05T14:00:00Z"))).toEqual({ ymd: "2026-07-06", hour: 0, weekday: 1 })
  })
})

describe("sydneyWeekStartYMD", () => {
  it("returns the same day on a Monday", () => {
    expect(sydneyWeekStartYMD(new Date("2026-07-05T14:00:00Z"))).toBe("2026-07-06")
  })
  it("returns the previous Monday on a Sunday, across a month boundary", () => {
    // 2026-08-02 02:00 UTC = Sun 2026-08-02 12:00 AEST
    expect(sydneyWeekStartYMD(new Date("2026-08-02T02:00:00Z"))).toBe("2026-07-27")
  })
})

describe("sydneyMonthKey", () => {
  it("is the Sydney month, rolling over at Sydney midnight not UTC midnight", () => {
    // 2026-06-30 14:00 UTC = Wed 2026-07-01 00:00 AEST
    expect(sydneyMonthKey(new Date("2026-06-30T14:00:00Z"))).toBe("2026-07")
    expect(sydneyMonthKey(new Date("2026-06-30T13:59:00Z"))).toBe("2026-06")
  })
  it("handles the year boundary under daylight saving (AEDT)", () => {
    // 2026-12-31 13:00 UTC = Fri 2027-01-01 00:00 AEDT
    expect(sydneyMonthKey(new Date("2026-12-31T13:00:00Z"))).toBe("2027-01")
    expect(sydneyMonthKey(new Date("2026-12-31T12:59:00Z"))).toBe("2026-12")
  })
})
