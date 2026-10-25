/** @jest-environment node */
import { buildMonthGrid, calendarStatusLabel, clampCalendarMonth, type CalendarEntry } from "@/lib/venueCalendar"

describe("clampCalendarMonth", () => {
  const today = "2026-10-25"
  it("defaults to the current month for missing or invalid input", () => {
    expect(clampCalendarMonth(undefined, today)).toBe("2026-10")
    expect(clampCalendarMonth("nope", today)).toBe("2026-10")
    expect(clampCalendarMonth("2026-13", today)).toBe("2026-10")
  })
  it("allows -12 to +6 months and clamps beyond", () => {
    expect(clampCalendarMonth("2025-10", today)).toBe("2025-10")
    expect(clampCalendarMonth("2025-09", today)).toBe("2025-10")
    expect(clampCalendarMonth("2027-04", today)).toBe("2027-04")
    expect(clampCalendarMonth("2027-05", today)).toBe("2027-04")
  })
  it("crosses the year boundary", () => {
    expect(clampCalendarMonth("2027-02", "2026-12-31")).toBe("2027-02")
    expect(clampCalendarMonth("2028-01", "2026-12-31")).toBe("2027-06")
  })
})

describe("buildMonthGrid", () => {
  const e = (id: number, date: string, status: CalendarEntry["status"] = "CONFIRMED"): CalendarEntry =>
    ({ id, date, startTime: "17:00", endTime: "20:00", purpose: null, status })
  it("builds Sunday-first full weeks with out-of-month padding (Nov 2026 starts on a Sunday)", () => {
    const grid = buildMonthGrid("2026-11", [e(1, "2026-11-01"), e(2, "2026-11-08", "REQUESTED")])
    expect(grid[0][0]).toMatchObject({ ymd: "2026-11-01", day: 1, inMonth: true })
    expect(grid[0][0].entries.map((x) => x.id)).toEqual([1])
    expect(grid[1][0].entries.map((x) => x.id)).toEqual([2])
    expect(grid.every((w) => w.length === 7)).toBe(true)
    expect(grid.at(-1)!.at(-1)!.ymd).toBe("2026-12-05")
    expect(grid.at(-1)!.at(-1)!.inMonth).toBe(false)
  })
  it("pads the first week with the previous month (Oct 2026 starts on a Thursday)", () => {
    const grid = buildMonthGrid("2026-10", [])
    expect(grid[0].map((c) => c.ymd).slice(0, 4)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"])
    expect(grid[0].slice(0, 4).every((c) => !c.inMonth)).toBe(true)
  })
  it("never attaches entries to padding cells and sorts a cell's entries by start time", () => {
    const grid = buildMonthGrid("2026-10", [{ ...e(1, "2026-09-30"), startTime: "09:00" }, { ...e(2, "2026-10-04"), startTime: "18:00" }, { ...e(3, "2026-10-04"), startTime: "09:00" }])
    expect(grid[0].flatMap((c) => c.entries)).toEqual([])
    const sunday = grid[1][0]
    expect(sunday.entries.map((x) => x.id)).toEqual([3, 2])
  })
})
it("labels statuses", () => {
  expect(calendarStatusLabel("CONFIRMED")).toBe("Confirmed")
  expect(calendarStatusLabel("REQUESTED")).toBe("Pending")
})
