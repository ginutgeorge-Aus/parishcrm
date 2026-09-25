import { sydneyParts, sydneyTodayYMD, sydneyToday, endOfDayUTC, sydneyStartOfDayUTC, sydneyEndOfDayUTC, mostRecentSundayYMD, sundaysBetween, formatSydneyDateTime } from "@/lib/dates"

describe("sydneyParts", () => {
  it("rolls into the next calendar day once Sydney passes midnight (winter, UTC+10)", () => {
    // 2025-06-30 20:00 UTC = 2025-07-01 06:00 Australia/Sydney
    expect(sydneyParts(new Date("2025-06-30T20:00:00Z"))).toEqual({ year: 2025, month: 7, day: 1 })
  })

  it("stays on the UTC day when Sydney is still before midnight", () => {
    // 2025-06-30 13:00 UTC = 2025-06-30 23:00 Australia/Sydney
    expect(sydneyParts(new Date("2025-06-30T13:00:00Z"))).toEqual({ year: 2025, month: 6, day: 30 })
  })

  it("honours daylight saving (summer, UTC+11)", () => {
    // 2026-01-31 13:30 UTC = 2026-02-01 00:30 Australia/Sydney
    expect(sydneyParts(new Date("2026-01-31T13:30:00Z"))).toEqual({ year: 2026, month: 2, day: 1 })
  })
})

describe("sydneyTodayYMD", () => {
  it("formats the Sydney calendar date as YYYY-MM-DD", () => {
    expect(sydneyTodayYMD(new Date("2025-06-30T20:00:00Z"))).toBe("2025-07-01")
    expect(sydneyTodayYMD(new Date("2026-02-09T05:00:00Z"))).toBe("2026-02-09")
  })
})

describe("sydneyToday", () => {
  it("returns the Sydney calendar date anchored at UTC midnight", () => {
    expect(sydneyToday(new Date("2025-06-30T20:00:00Z"))).toEqual(new Date("2025-07-01T00:00:00.000Z"))
  })
})

describe("endOfDayUTC", () => {
  it("returns 23:59:59.999Z for a UTC-midnight calendar date", () => {
    expect(endOfDayUTC(new Date("2025-07-01T00:00:00.000Z"))).toEqual(new Date("2025-07-01T23:59:59.999Z"))
  })
})

describe("sydneyStartOfDayUTC", () => {
  it("maps a winter (AEST, UTC+10) Sydney date start to the prior UTC day 14:00", () => {
    // Sydney 2026-06-20 00:00 AEST = 2026-06-19 14:00 UTC
    expect(sydneyStartOfDayUTC("2026-06-20")).toEqual(new Date("2026-06-19T14:00:00.000Z"))
  })

  it("maps a summer (AEDT, UTC+11) Sydney date start to the prior UTC day 13:00", () => {
    // Sydney 2026-01-15 00:00 AEDT = 2026-01-14 13:00 UTC
    expect(sydneyStartOfDayUTC("2026-01-15")).toEqual(new Date("2026-01-14T13:00:00.000Z"))
  })
})

describe("sydneyEndOfDayUTC", () => {
  it("maps a winter (AEST) Sydney date end to the same UTC day 13:59:59.999", () => {
    // Sydney 2026-06-20 23:59:59.999 AEST = 2026-06-20 13:59:59.999 UTC
    expect(sydneyEndOfDayUTC("2026-06-20")).toEqual(new Date("2026-06-20T13:59:59.999Z"))
  })

  it("maps a summer (AEDT) Sydney date end to the same UTC day 12:59:59.999", () => {
    // Sydney 2026-01-15 23:59:59.999 AEDT = 2026-01-15 12:59:59.999 UTC
    expect(sydneyEndOfDayUTC("2026-01-15")).toEqual(new Date("2026-01-15T12:59:59.999Z"))
  })
})

describe("mostRecentSundayYMD", () => {
  it("returns the same day when that Sydney day is a Sunday", () => {
    // 2026-06-14 is a Sunday. 12:00 UTC = 22:00 Sydney, still the 14th.
    expect(mostRecentSundayYMD(new Date("2026-06-14T12:00:00Z"))).toBe("2026-06-14")
  })

  it("walks back to the prior Sunday on a weekday", () => {
    // 2026-06-17 is a Wednesday -> prior Sunday is 2026-06-14.
    expect(mostRecentSundayYMD(new Date("2026-06-17T12:00:00Z"))).toBe("2026-06-14")
  })

  it("walks back to the prior Sunday on a Saturday", () => {
    // 2026-06-20 is a Saturday -> prior Sunday is 2026-06-14.
    expect(mostRecentSundayYMD(new Date("2026-06-20T12:00:00Z"))).toBe("2026-06-14")
  })

  it("wraps across a month/year boundary", () => {
    // 2026-01-01 is a Thursday -> prior Sunday is 2025-12-28.
    expect(mostRecentSundayYMD(new Date("2026-01-01T12:00:00Z"))).toBe("2025-12-28")
  })

  it("uses the Sydney calendar day, not the UTC day", () => {
    // 2026-06-13 20:00 UTC = 2026-06-14 06:00 Sydney (Sunday) -> 2026-06-14.
    expect(mostRecentSundayYMD(new Date("2026-06-13T20:00:00Z"))).toBe("2026-06-14")
  })
})

describe("sundaysBetween", () => {
  it("collapses a from/to within the same week to that week's single Sunday", () => {
    // 2026-06-08 Mon … 2026-06-13 Sat both fall in the week of Sunday 2026-06-07
    expect(sundaysBetween("2026-06-08", "2026-06-13")).toEqual(["2026-06-07"])
  })

  it("includes both endpoints when they are exact Sundays", () => {
    expect(sundaysBetween("2026-05-31", "2026-06-14")).toEqual([
      "2026-05-31",
      "2026-06-07",
      "2026-06-14",
    ])
  })

  it("snaps mid-week endpoints back to their week's Sunday", () => {
    // from Wed 2026-06-10 (week of 06-07) … to Sun 2026-06-14
    expect(sundaysBetween("2026-06-10", "2026-06-14")).toEqual(["2026-06-07", "2026-06-14"])
  })

  it("returns [] when from is after to", () => {
    expect(sundaysBetween("2026-06-14", "2026-06-01")).toEqual([])
  })

  it("spans Sep 2025 → Jun 2026 inclusive with 7-day steps", () => {
    const result = sundaysBetween("2025-09-01", "2026-06-14")
    expect(result[0]).toBe("2025-08-31") // week of 2025-09-01 (a Monday)
    expect(result.at(-1)).toBe("2026-06-14")
    expect(result.length).toBe(42)
    // every consecutive pair is exactly 7 days apart, no duplicates
    for (let i = 1; i < result.length; i++) {
      const prev = new Date(result[i - 1] + "T00:00:00Z").getTime()
      const cur = new Date(result[i] + "T00:00:00Z").getTime()
      expect(cur - prev).toBe(7 * 24 * 60 * 60 * 1000)
    }
  })
})

describe("formatSydneyDateTime", () => {
  it("renders a UTC instant as Sydney dd/MM/yyyy HH:mm (not the server/UTC clock)", () => {
    // 08:30 AEDT on 8 Oct 2026 is stored as 21:30Z the day before. UTC format()
    // would print 07/10/2026 21:30 — must be 08/10/2026 08:30.
    expect(formatSydneyDateTime(new Date("2026-10-07T21:30:00.000Z"))).toBe("08/10/2026 08:30")
  })

  it("pads single-digit day/month/hour/minute", () => {
    // 09:05 AEST on 3 Aug 2026 → 23:05Z on the 2nd.
    expect(formatSydneyDateTime(new Date("2026-08-02T23:05:00.000Z"))).toBe("03/08/2026 09:05")
  })

  it("handles Sydney midnight without a day-behind shift (ICU hour-24 quirk)", () => {
    // Sydney 00:00 AEDT on 1 Jan 2027 = 13:00Z on 31 Dec 2026.
    expect(formatSydneyDateTime(new Date("2026-12-31T13:00:00.000Z"))).toBe("01/01/2027 00:00")
  })
})
