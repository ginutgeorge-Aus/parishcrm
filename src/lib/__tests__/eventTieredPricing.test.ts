import { computeTieredTotal } from "@/lib/eventTieredPricing"

const TIERS = [60, 120, 150, 180] // dollars, index 0 = price for 1 attendee

describe("computeTieredTotal", () => {
  it("prices counts within the table (cents)", () => {
    expect(computeTieredTotal(TIERS, 1)).toEqual({ ok: true, totalCents: 6000 })
    expect(computeTieredTotal(TIERS, 3)).toEqual({ ok: true, totalCents: 15000 })
  })

  it("prices exactly at the max tier", () => {
    expect(computeTieredTotal(TIERS, 4)).toEqual({ ok: true, totalCents: 18000 })
  })

  it("rejects counts over the table with the max", () => {
    expect(computeTieredTotal(TIERS, 5)).toEqual({ ok: false, maxAttendees: 4 })
  })

  it("handles a single-tier table", () => {
    expect(computeTieredTotal([25], 1)).toEqual({ ok: true, totalCents: 2500 })
    expect(computeTieredTotal([25], 2)).toEqual({ ok: false, maxAttendees: 1 })
  })

  it("supports a $0 first tier", () => {
    expect(computeTieredTotal([0, 50], 1)).toEqual({ ok: true, totalCents: 0 })
  })

  it("returns 0 for a non-positive count", () => {
    expect(computeTieredTotal(TIERS, 0)).toEqual({ ok: true, totalCents: 0 })
  })
})
