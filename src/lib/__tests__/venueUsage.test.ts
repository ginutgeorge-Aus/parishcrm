/** @jest-environment node */
import {
  parseTimeToMinutes, isValidTime, validateTimeRange, durationHours, formatHours, formatTime12,
  formatUsageDate, isValidYMD, ymdToUtcDate, utcDateToYmd, isValidMonth, monthRange, previousMonth,
  formatMonthLabel, nextSundayYMD, escapeHtml, formatUsageLine, totalHours, buildRequestEmail, confirmedOnly, defaultStatusForDate,
  parseCcList, MAX_BOOKING_CC,
  sundaysInMonth, addMonths, monthCompleteness, describeIncomplete,
} from "@/lib/venueUsage"

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

describe("time parsing", () => {
  it.each([
    ["00:00", 0], ["00:30", 30], ["09:05", 545], ["17:00", 1020], ["23:59", 1439],
  ])("parses %s", (v, mins) => expect(parseTimeToMinutes(v)).toBe(mins))

  it.each(["", "5:00", "24:00", "12:60", "17:0", "17:00:00", "ab:cd", "17.00", " 17:00", "-1:00"])(
    "rejects %j", (v) => {
      expect(parseTimeToMinutes(v)).toBeNull()
      expect(isValidTime(v)).toBe(false)
    })

  it("isValidTime accepts valid", () => expect(isValidTime("08:15")).toBe(true))
})

describe("validateTimeRange / durationHours", () => {
  it("accepts a normal range", () => expect(validateTimeRange("17:00", "20:30")).toBeNull())
  it("rejects end == start", () => expect(validateTimeRange("17:00", "17:00")).toMatch(/after/))
  it("rejects end < start (no overnight)", () => expect(validateTimeRange("22:00", "01:00")).toMatch(/after/))
  it("rejects invalid start", () => expect(validateTimeRange("25:00", "26:00")).toMatch(/Start/))
  it("rejects invalid end", () => expect(validateTimeRange("10:00", "99:99")).toMatch(/End/))

  it.each([
    ["17:00", "20:30", 3.5], ["17:00", "20:00", 3], ["09:00", "09:30", 0.5],
    ["00:00", "23:59", 1439 / 60], ["10:15", "11:00", 0.75],
  ])("duration %s-%s = %s", (s, e, h) => expect(durationHours(s, e)).toBeCloseTo(h, 10))

  it("throws on invalid / non-positive ranges", () => {
    expect(() => durationHours("17:00", "17:00")).toThrow(RangeError)
    expect(() => durationHours("20:00", "17:00")).toThrow(RangeError)
    expect(() => durationHours("x", "17:00")).toThrow(RangeError)
  })
})

describe("formatting", () => {
  it.each([
    ["00:00", "12:00 AM"], ["00:30", "12:30 AM"], ["09:05", "9:05 AM"], ["12:00", "12:00 PM"],
    ["12:30", "12:30 PM"], ["13:00", "1:00 PM"], ["17:00", "5:00 PM"], ["23:59", "11:59 PM"],
  ])("formatTime12 %s", (v, out) => expect(formatTime12(v)).toBe(out))

  it("formatTime12 throws on invalid", () => expect(() => formatTime12("24:00")).toThrow(RangeError))

  it("formatHours singular/plural/trim", () => {
    expect(formatHours(1)).toBe("1 hour")
    expect(formatHours(3.5)).toBe("3.5 hours")
    expect(formatHours(3)).toBe("3 hours")
    expect(formatHours(0.5)).toBe("0.5 hours")
    expect(formatHours(2.25)).toBe("2.25 hours")
    expect(formatHours(1 / 3)).toBe("0.33 hours")
  })

  it("formatUsageDate reads the UTC calendar date", () => {
    expect(formatUsageDate(d("2026-09-06"))).toBe("Sunday, 6 September")
    expect(formatUsageDate(d("2026-01-01"))).toBe("Thursday, 1 January")
    expect(formatUsageDate(d("2026-12-31"))).toBe("Thursday, 31 December")
  })

  it("formatUsageLine matches the required shape", () => {
    expect(formatUsageLine({ date: d("2026-09-06"), startTime: "17:00", endTime: "20:30" })).toBe(
      "Sunday, 6 September: 5:00 PM – 8:30 PM (3.5 hours)",
    )
  })

  it("formatMonthLabel", () => {
    expect(formatMonthLabel("2026-09")).toBe("September 2026")
    expect(formatMonthLabel("2027-01")).toBe("January 2027")
    expect(() => formatMonthLabel("2026-13")).toThrow(RangeError)
  })
})

describe("dates and months", () => {
  it("isValidYMD", () => {
    expect(isValidYMD("2026-09-06")).toBe(true)
    expect(isValidYMD("2024-02-29")).toBe(true)
    expect(isValidYMD("2026-02-29")).toBe(false)
    expect(isValidYMD("2026-04-31")).toBe(false)
    expect(isValidYMD("2026-9-6")).toBe(false)
    expect(isValidYMD("")).toBe(false)
  })

  it("ymdToUtcDate / utcDateToYmd round-trip at UTC midnight", () => {
    const date = ymdToUtcDate("2026-09-06")
    expect(date.toISOString()).toBe("2026-09-06T00:00:00.000Z")
    expect(utcDateToYmd(date)).toBe("2026-09-06")
    expect(() => ymdToUtcDate("2026-02-30")).toThrow(RangeError)
  })

  it("isValidMonth", () => {
    expect(isValidMonth("2026-09")).toBe(true)
    expect(isValidMonth("2026-00")).toBe(false)
    expect(isValidMonth("2026-13")).toBe(false)
    expect(isValidMonth("2026-9")).toBe(false)
    expect(isValidMonth("2026-09-01")).toBe(false)
  })

  it("monthRange covers first to last day inclusive", () => {
    const r = monthRange("2026-09")
    expect(r.start.toISOString()).toBe("2026-09-01T00:00:00.000Z")
    expect(r.end.toISOString()).toBe("2026-09-30T00:00:00.000Z")
  })

  it("monthRange boundaries: 31-day, Feb leap/non-leap, December", () => {
    expect(monthRange("2026-01").end.toISOString()).toBe("2026-01-31T00:00:00.000Z")
    expect(monthRange("2026-02").end.toISOString()).toBe("2026-02-28T00:00:00.000Z")
    expect(monthRange("2028-02").end.toISOString()).toBe("2028-02-29T00:00:00.000Z")
    expect(monthRange("2026-12").end.toISOString()).toBe("2026-12-31T00:00:00.000Z")
    expect(() => monthRange("bad")).toThrow(RangeError)
  })

  it("previousMonth", () => {
    expect(previousMonth("2026-10-25")).toBe("2026-09")
    expect(previousMonth("2026-03-01")).toBe("2026-02")
    expect(previousMonth("2026-01-15")).toBe("2025-12")
    expect(previousMonth("2026-12-31")).toBe("2026-11")
    expect(() => previousMonth("2026-1-1")).toThrow(RangeError)
  })

  it("nextSundayYMD", () => {
    expect(nextSundayYMD("2026-09-06")).toBe("2026-09-06") // a Sunday
    expect(nextSundayYMD("2026-09-07")).toBe("2026-09-13") // Monday
    expect(nextSundayYMD("2026-09-12")).toBe("2026-09-13") // Saturday
    expect(nextSundayYMD("2026-12-30")).toBe("2027-01-03") // year rollover
  })
})

describe("totalHours", () => {
  it("sums and rounds", () => {
    expect(totalHours([])).toBe(0)
    expect(
      totalHours([
        { date: d("2026-09-06"), startTime: "17:00", endTime: "20:30" },
        { date: d("2026-09-13"), startTime: "17:00", endTime: "20:00" },
        { date: d("2026-09-20"), startTime: "09:00", endTime: "09:30" },
      ]),
    ).toBe(7)
  })
})

describe("booking status", () => {
  const mk = (status?: "REQUESTED" | "CONFIRMED" | "CANCELLED") => ({
    date: d("2026-09-06"), startTime: "17:00", endTime: "18:00", status,
  })

  it("confirmedOnly keeps CONFIRMED and status-less rows", () => {
    const rows = [mk("CONFIRMED"), mk("REQUESTED"), mk("CANCELLED"), mk()]
    expect(confirmedOnly(rows)).toHaveLength(2)
  })

  it("totalHours ignores requested and cancelled", () => {
    expect(totalHours([mk("CONFIRMED"), mk("REQUESTED"), mk("CANCELLED")])).toBe(1)
  })

  it("defaultStatusForDate: future REQUESTED, today/past CONFIRMED", () => {
    expect(defaultStatusForDate("2026-09-07", "2026-09-06")).toBe("REQUESTED")
    expect(defaultStatusForDate("2026-09-06", "2026-09-06")).toBe("CONFIRMED")
    expect(defaultStatusForDate("2026-09-05", "2026-09-06")).toBe("CONFIRMED")
  })

  it("buildRequestEmail excludes cancelled/requested rows from lines and total", () => {
    const { text, html } = buildRequestEmail({
      churchName: "Example Church", venueName: "Example Hall", contactName: "Pat", month: "2026-09",
      rows: [
        { date: d("2026-09-06"), startTime: "17:00", endTime: "20:30", status: "CONFIRMED" },
        { date: d("2026-09-13"), startTime: "17:00", endTime: "20:00", status: "CANCELLED" },
        { date: d("2026-09-20"), startTime: "17:00", endTime: "20:00", status: "REQUESTED" },
      ],
    })
    expect(text).toContain("6 September")
    expect(text).not.toContain("13 September")
    expect(text).not.toContain("20 September")
    expect(text).toContain("Total: 3.5 hours")
    expect(html).not.toContain("13 September")
  })
})

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;")
  })
})

describe("buildRequestEmail", () => {
  const base = {
    churchName: "Example Church",
    venueName: "Example Hall",
    contactName: "Pat Example",
    month: "2026-09",
    senderName: "Sam Admin",
  }
  const rows = [
    { date: d("2026-09-20"), startTime: "17:00", endTime: "20:00" },
    { date: d("2026-09-06"), startTime: "17:00", endTime: "20:30" },
  ]

  it("builds subject, lists sorted lines and total", () => {
    const { subject, text } = buildRequestEmail({ ...base, rows })
    expect(subject).toBe("Invoice request: September 2026 venue usage (Example Church)")
    expect(text).toContain("Dear Pat Example,")
    expect(text).toContain("use of Example Hall during September 2026")
    const first = text.indexOf("- Sunday, 6 September: 5:00 PM – 8:30 PM (3.5 hours)")
    const second = text.indexOf("- Sunday, 20 September: 5:00 PM – 8:00 PM (3 hours)")
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(text).toContain("Total: 6.5 hours")
    expect(text.trimEnd().endsWith("Sam Admin\nExample Church")).toBe(true)
  })

  it("does not mutate the input rows", () => {
    const copy = [...rows]
    buildRequestEmail({ ...base, rows })
    expect(rows).toEqual(copy)
  })

  it("HTML output has the same content", () => {
    const { html } = buildRequestEmail({ ...base, rows })
    expect(html).toContain("<li>Sunday, 6 September: 5:00 PM – 8:30 PM (3.5 hours)</li>")
    expect(html).toContain("Total: 6.5 hours")
  })

  it("HTML-escapes every interpolated value (not in plain text)", () => {
    const evil = "<script>alert(1)</script>"
    const { html, text } = buildRequestEmail({
      churchName: evil, venueName: evil, contactName: evil, month: "2026-09", rows, senderName: evil,
    })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(text).toContain(evil)
  })

  it("falls back for blank contact / venue / sender", () => {
    const { text } = buildRequestEmail({
      churchName: "Example Church", venueName: " ", contactName: "", month: "2026-09", rows, senderName: null,
    })
    expect(text.startsWith("Hello,")).toBe(true)
    expect(text).toContain("use of your venue")
    expect(text.trimEnd().endsWith("Kind regards,\nExample Church")).toBe(true)
  })

  it("throws on an invalid month or invalid row times", () => {
    expect(() => buildRequestEmail({ ...base, month: "2026-13", rows })).toThrow(RangeError)
    expect(() =>
      buildRequestEmail({ ...base, rows: [{ date: d("2026-09-06"), startTime: "20:00", endTime: "17:00" }] }),
    ).toThrow(RangeError)
  })
})

describe("parseCcList", () => {
  it("splits on comma, semicolon and newline, trims and de-duplicates case-insensitively", () => {
    expect(parseCcList("a@example.com; B@example.com,\n a@EXAMPLE.com , ")).toEqual({
      ok: true,
      list: ["a@example.com", "B@example.com"],
    })
  })
  it("accepts an empty value", () => {
    expect(parseCcList("  ")).toEqual({ ok: true, list: [] })
  })
  it("rejects an invalid address and names it", () => {
    expect(parseCcList("a@example.com, nope")).toEqual({ ok: false, error: '"nope" is not a valid email address' })
  })
  it("rejects more than the maximum", () => {
    const many = Array.from({ length: MAX_BOOKING_CC + 1 }, (_, i) => `u${i}@example.com`).join(",")
    expect(parseCcList(many)).toEqual({ ok: false, error: `Add at most ${MAX_BOOKING_CC} booking CC addresses` })
  })
})

describe("sundaysInMonth / addMonths", () => {
  it("lists every Sunday of a month", () => {
    expect(sundaysInMonth("2026-09")).toEqual(["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"])
    expect(sundaysInMonth("2026-11")).toEqual(["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"])
    expect(sundaysInMonth("2027-01")).toEqual(["2027-01-03", "2027-01-10", "2027-01-17", "2027-01-24", "2027-01-31"])
  })
  it("handles a leap February", () => {
    expect(sundaysInMonth("2028-02")).toEqual(["2028-02-06", "2028-02-13", "2028-02-20", "2028-02-27"])
  })
  it("rejects a malformed month", () => {
    expect(() => sundaysInMonth("2026-13")).toThrow(RangeError)
  })
  it("adds months across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01")
    expect(addMonths("2026-01", -1)).toBe("2025-12")
    expect(addMonths("2026-10", -12)).toBe("2025-10")
    expect(addMonths("2026-10", 6)).toBe("2027-04")
  })
})

describe("monthCompleteness", () => {
  const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`)
  const sep = (day: string, status: "REQUESTED" | "CONFIRMED" | "CANCELLED") => ({ date: d(`2026-09-${day}`), status })
  it("is complete when every Sunday is confirmed or cancelled and one is confirmed", () => {
    const c = monthCompleteness("2026-09", [sep("06", "CONFIRMED"), sep("13", "CANCELLED"), sep("20", "CONFIRMED"), sep("27", "CONFIRMED")])
    expect(c).toEqual({ complete: true, missingSundays: [], requestedCount: 0, confirmedCount: 3 })
    expect(describeIncomplete(c)).toEqual([])
  })
  it("is incomplete with a Sunday that has no row", () => {
    const c = monthCompleteness("2026-09", [sep("06", "CONFIRMED"), sep("20", "CONFIRMED"), sep("27", "CONFIRMED")])
    expect(c.complete).toBe(false)
    expect(c.missingSundays).toEqual(["2026-09-13"])
    expect(describeIncomplete(c)).toEqual(["No confirmed or cancelled booking for: Sunday, 13 September"])
  })
  it("is incomplete while any row is still REQUESTED (even on a non-Sunday)", () => {
    const c = monthCompleteness("2026-09", [
      sep("06", "CONFIRMED"), sep("13", "CONFIRMED"), sep("20", "CONFIRMED"), sep("27", "CONFIRMED"), sep("10", "REQUESTED"),
    ])
    expect(c.complete).toBe(false)
    expect(describeIncomplete(c)).toEqual(["1 date is still marked Requested"])
  })
  it("is incomplete with nothing confirmed", () => {
    const c = monthCompleteness("2026-09", ["06", "13", "20", "27"].map((x) => sep(x, "CANCELLED")))
    expect(c.complete).toBe(false)
    expect(describeIncomplete(c)).toEqual(["No confirmed bookings in this month"])
  })
  it("ignores rows outside the month and counts a Sunday settled by a second row", () => {
    const c = monthCompleteness("2026-09", [
      { date: d("2026-08-30"), status: "REQUESTED" },
      sep("06", "CANCELLED"), sep("06", "CONFIRMED"), sep("13", "CONFIRMED"), sep("20", "CONFIRMED"), sep("27", "CONFIRMED"),
    ])
    expect(c.complete).toBe(true)
  })
})
