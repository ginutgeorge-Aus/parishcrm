import { parseRollDate, rollCounts, parseAttendanceStatus, ymdToDbDate, ATTENDANCE_STATUSES } from "@/lib/sundaySchoolRollView"

describe("parseRollDate", () => {
  const today = "2026-10-11"
  it("defaults to today when missing/blank", () => {
    expect(parseRollDate(undefined, 2026, today)).toEqual({ ok: true, ymd: today })
    expect(parseRollDate("", 2026, today)).toEqual({ ok: true, ymd: today })
  })
  it("accepts a past date in the class year", () => {
    expect(parseRollDate("2026-02-01", 2026, today)).toEqual({ ok: true, ymd: "2026-02-01" })
  })
  it("rejects malformed, impossible, future and other-year dates", () => {
    expect(parseRollDate("2026-02-30", 2026, today).ok).toBe(false)
    expect(parseRollDate("11/10/2026", 2026, today).ok).toBe(false)
    expect(parseRollDate("2026-10-12", 2026, today)).toEqual({ ok: false, error: "Can't take a roll for a future date" })
    expect(parseRollDate("2025-12-28", 2026, today)).toEqual({ ok: false, error: "This class is for 2026" })
  })
  it("today in a different year than the class (viewing last year's class) still validates the year", () => {
    expect(parseRollDate(undefined, 2025, "2026-01-04")).toEqual({ ok: false, error: "This class is for 2025" })
  })
})

describe("parseAttendanceStatus", () => {
  it("maps values", () => {
    expect(parseAttendanceStatus("LATE")).toBe("LATE")
    expect(parseAttendanceStatus(null)).toBeNull()
    expect(parseAttendanceStatus("present")).toBeUndefined()
    expect(parseAttendanceStatus(undefined)).toBeUndefined()
  })
})

describe("rollCounts", () => {
  it("counts each status; attended = present + late", () => {
    const r = (status: string | null) => ({ personId: 1, name: "x", status, enrolled: true }) as never
    expect(rollCounts([r("PRESENT"), r("LATE"), r("ABSENT"), r(null), r(null)]))
      .toEqual({ present: 1, late: 1, absent: 1, unmarked: 2, attended: 2 })
  })
})

it("ymdToDbDate is UTC midnight", () => {
  expect(ymdToDbDate("2026-10-11").toISOString()).toBe("2026-10-11T00:00:00.000Z")
})
it("button order", () => expect(ATTENDANCE_STATUSES).toEqual(["PRESENT", "LATE", "ABSENT"]))
