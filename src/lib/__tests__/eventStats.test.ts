import { rollupEventStats } from "@/lib/eventStats"

describe("rollupEventStats", () => {
  it("sums PAID revenue and ticket quantities per event", () => {
    // events 1 and 2; event 1 owns ticketTypes 10,11; event 2 owns ticketType 20
    const ttToEvent = new Map<number, number>([
      [10, 1],
      [11, 1],
      [20, 2],
    ])
    const revenueRows = [
      { eventId: 1, _sum: { totalAmount: "150.00" } },
      { eventId: 2, _sum: { totalAmount: "40.50" } },
    ]
    const soldRows = [
      { ticketTypeId: 10, _sum: { quantity: 3 } },
      { ticketTypeId: 11, _sum: { quantity: 2 } },
      { ticketTypeId: 20, _sum: { quantity: 7 } },
    ]

    const stats = rollupEventStats(ttToEvent, revenueRows, soldRows)

    expect(stats.get(1)).toEqual({ ticketsSold: 5, revenue: 150 })
    expect(stats.get(2)).toEqual({ ticketsSold: 7, revenue: 40.5 })
  })

  it("keeps decimal cents exact over a long run (no IEEE-754 drift)", () => {
    const ttToEvent = new Map<number, number>()
    // 0.10 summed by Postgres and returned as one Decimal — helper converts once
    const stats = rollupEventStats(
      ttToEvent,
      [{ eventId: 1, _sum: { totalAmount: "999999.99" } }],
      [],
    )
    expect(stats.get(1)?.revenue).toBe(999999.99)
  })

  it("treats a missing aggregate (null _sum) as zero", () => {
    const stats = rollupEventStats(
      new Map([[10, 1]]),
      [{ eventId: 1, _sum: { totalAmount: null } }],
      [{ ticketTypeId: 10, _sum: { quantity: null } }],
    )
    expect(stats.get(1)).toEqual({ ticketsSold: 0, revenue: 0 })
  })

  it("returns no entry for an event with no registrations or tickets sold", () => {
    const stats = rollupEventStats(new Map([[10, 1]]), [], [])
    expect(stats.get(1)).toBeUndefined()
  })

  it("ignores sold rows whose ticketType maps to no known event", () => {
    const stats = rollupEventStats(
      new Map([[10, 1]]),
      [],
      [{ ticketTypeId: 99, _sum: { quantity: 4 } }],
    )
    expect(stats.get(1)).toBeUndefined()
  })
})
