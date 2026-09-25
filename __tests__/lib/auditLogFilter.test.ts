import { buildCreatedAtFilter } from "@/lib/auditLogFilter"

describe("buildCreatedAtFilter", () => {
  it("returns undefined when neither bound is provided", () => {
    expect(buildCreatedAtFilter()).toBeUndefined()
    expect(buildCreatedAtFilter(undefined, undefined)).toBeUndefined()
    expect(buildCreatedAtFilter("", "")).toBeUndefined()
  })

  it("ignores non-ISO date strings", () => {
    expect(buildCreatedAtFilter("not-a-date", "23/06/2026")).toBeUndefined()
    expect(buildCreatedAtFilter("2026-6-1")).toBeUndefined() // not zero-padded
  })

  it("ignores calendar-invalid dates that match the digit-shape regex", () => {
    // Feb has no 30th/31st — JS Date silently rolls these over to March instead
    // of throwing, so a naive regex+Date pipeline would (mis)filter as if the
    // caller had typed a valid, different date.
    expect(buildCreatedAtFilter("2026-02-30")).toBeUndefined()
    expect(buildCreatedAtFilter("2026-02-31")).toBeUndefined()
    expect(buildCreatedAtFilter(undefined, "2026-04-31")).toBeUndefined() // April has 30 days
    expect(buildCreatedAtFilter("2026-13-01")).toBeUndefined() // month 13
    expect(buildCreatedAtFilter("2026-00-01")).toBeUndefined() // month 0
    expect(buildCreatedAtFilter("2026-01-00")).toBeUndefined() // day 0
    expect(buildCreatedAtFilter("2025-02-29")).toBeUndefined() // 2025 is not a leap year
  })

  it("still accepts a genuine leap-day date", () => {
    // 2024 is a leap year, so Feb 29 is a real calendar date.
    const f = buildCreatedAtFilter("2024-02-29")
    expect(f).toBeDefined()
  })

  it("sets only gte when from is given (partial input)", () => {
    const f = buildCreatedAtFilter("2026-06-23")
    // Sydney 2026-06-23 00:00 AEST (UTC+10) = 2026-06-22 14:00 UTC
    expect(f).toEqual({ gte: new Date("2026-06-22T14:00:00.000Z") })
    expect(f).not.toHaveProperty("lte")
  })

  it("sets only lte when to is given (partial input)", () => {
    const f = buildCreatedAtFilter(undefined, "2026-06-23")
    // Sydney 2026-06-23 23:59:59.999 AEST = 2026-06-23 13:59:59.999 UTC (sentinel end-of-day)
    expect(f).toEqual({ lte: new Date("2026-06-23T13:59:59.999Z") })
    expect(f).not.toHaveProperty("gte")
  })

  it("anchors a winter (AEST, UTC+10) day to the correct UTC bounds", () => {
    const f = buildCreatedAtFilter("2026-06-20", "2026-06-23")
    expect(f).toEqual({
      gte: new Date("2026-06-19T14:00:00.000Z"),
      lte: new Date("2026-06-23T13:59:59.999Z"),
    })
  })

  it("anchors a summer (AEDT, UTC+11) day to the correct UTC bounds", () => {
    const f = buildCreatedAtFilter("2026-01-15", "2026-01-15")
    // start: Sydney 2026-01-15 00:00 AEDT = 2026-01-14 13:00 UTC
    // end:   Sydney 2026-01-15 23:59:59.999 AEDT = 2026-01-15 12:59:59.999 UTC
    expect(f).toEqual({
      gte: new Date("2026-01-14T13:00:00.000Z"),
      lte: new Date("2026-01-15T12:59:59.999Z"),
    })
  })

  it("keeps the .999ms sentinel on the lte upper bound", () => {
    const f = buildCreatedAtFilter(undefined, "2026-06-23")
    expect(f!.lte!.getUTCMilliseconds()).toBe(999)
  })
})
