import {
  formatSydneyDate,
  formatSydneyTime,
  sydneyDatetimeLocalToUTC,
  zoneLabel,
  toSydneyDatetimeLocal,
} from "@/lib/dates"

describe("timezone config", () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
    jest.resetModules()
  })
  const load = (tz?: string) => {
    process.env = { ...ORIGINAL, APP_TIMEZONE: tz }
    jest.resetModules()
    return require("@/lib/dates")
  }

  it("default renders the Sydney wall clock", () => {
    const { formatSydneyDate } = load(undefined)
    // 2025-07-01T00:00:00Z = 10:00 on 1 Jul in Sydney (AEST +10)
    expect(formatSydneyDate(new Date("2025-07-01T00:00:00Z"))).toBe("Tue 1 Jul 2025")
  })

  it("APP_TIMEZONE=America/New_York shifts the wall clock back a day", () => {
    const { formatSydneyDate } = load("America/New_York")
    // 2025-07-01T00:00:00Z = 20:00 on 30 Jun in New York (EDT -4)
    expect(formatSydneyDate(new Date("2025-07-01T00:00:00Z"))).toBe("Mon 30 Jun 2025")
  })
})

describe("sydneyDatetimeLocalToUTC", () => {
  it("reads a datetime-local string as Sydney AEDT wall clock (Oct, +11)", () => {
    // 8:30 AM Sydney on 8 Oct 2026 → 21:30 UTC the previous day
    expect(sydneyDatetimeLocalToUTC("2026-10-08T08:30").toISOString()).toBe(
      "2026-10-07T21:30:00.000Z",
    )
  })

  it("reads a datetime-local string as Sydney AEST wall clock (Jul, +10)", () => {
    // 8:30 AM Sydney on 8 Jul 2026 → 22:30 UTC the previous day
    expect(sydneyDatetimeLocalToUTC("2026-07-08T08:30").toISOString()).toBe(
      "2026-07-07T22:30:00.000Z",
    )
  })

  it("uses the offset at the represented instant, not the naive one, just before DST starts", () => {
    // DST starts 2026-10-04 02:00 AEST. 01:00 is still AEST (+10), but its naive
    // UTC reading (01:00Z = 12:00 AEDT) is past the transition.
    expect(sydneyDatetimeLocalToUTC("2026-10-04T01:00").toISOString()).toBe(
      "2026-10-03T15:00:00.000Z",
    )
  })
})

describe("toSydneyDatetimeLocal", () => {
  it("formats a UTC instant back to the Sydney wall clock (AEDT)", () => {
    expect(toSydneyDatetimeLocal(new Date("2026-10-07T21:30:00.000Z"))).toBe(
      "2026-10-08T08:30",
    )
  })

  it("round-trips a wall-clock string through store and prefill", () => {
    const local = "2026-10-08T08:30"
    expect(toSydneyDatetimeLocal(sydneyDatetimeLocalToUTC(local))).toBe(local)
  })

  it("round-trips Sydney midnight without slipping a day (hour-24 boundary)", () => {
    const local = "2026-10-08T00:00"
    expect(toSydneyDatetimeLocal(sydneyDatetimeLocalToUTC(local))).toBe(local)
  })
})

describe("formatSydneyDate", () => {
  it("renders a UTC instant as the Sydney wall-clock date (AEDT, +11)", () => {
    // 21:30 UTC = 8:30 AM Sydney on 8 Oct 2026
    expect(formatSydneyDate(new Date("2026-10-07T21:30:00.000Z"))).toBe(
      "Thu 8 Oct 2026",
    )
  })

  it("does not roll the date on a late-evening UTC instant (AEST, +10)", () => {
    // 22:30 UTC = 8:30 AM Sydney on 8 Jul 2026 (next Sydney day)
    expect(formatSydneyDate(new Date("2026-07-07T22:30:00.000Z"))).toBe(
      "Wed 8 Jul 2026",
    )
  })
})

describe("formatSydneyTime", () => {
  it("renders a UTC instant as the Sydney wall-clock time (AEDT, +11)", () => {
    expect(formatSydneyTime(new Date("2026-10-07T21:30:00.000Z"))).toBe(
      "8:30 AM",
    )
  })

  it("renders afternoon times with a PM period", () => {
    // 04:00 UTC = 3:00 PM Sydney (AEDT, +11 in Oct → 3pm)
    expect(formatSydneyTime(new Date("2026-10-08T04:00:00.000Z"))).toBe(
      "3:00 PM",
    )
  })
})

describe("zoneLabel", () => {
  it("labels the configured zone per instant, DST-aware", () => {
    expect(zoneLabel(new Date("2026-07-01T00:00:00Z"))).toBe("AEST")
    expect(zoneLabel(new Date("2026-12-01T00:00:00Z"))).toBe("AEDT")
  })
})
