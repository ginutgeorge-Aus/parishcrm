import { parseTiers } from "@/lib/eventTiers"

function fd(prices: string[]): FormData {
  const f = new FormData()
  prices.forEach((p, i) => f.set(`tier.${i}.price`, p))
  return f
}

describe("parseTiers", () => {
  it("parses ordered dollar tiers", () => {
    expect(parseTiers(fd(["60", "120", "150", "180"]))).toEqual({ tiers: [60, 120, 150, 180] })
  })
  it("skips a trailing blank row", () => {
    expect(parseTiers(fd(["60", "120", ""]))).toEqual({ tiers: [60, 120] })
  })
  it("rejects a non-money value", () => {
    expect(parseTiers(fd(["60", "12x"]))).toEqual({ error: expect.stringMatching(/tier 2/i) })
  })
  it("returns empty tiers when none entered", () => {
    expect(parseTiers(fd([]))).toEqual({ tiers: [] })
  })
  it("rejects a blank row between filled rows (would shift the schedule)", () => {
    expect(parseTiers(fd(["60", "", "180"]))).toEqual({ error: expect.stringMatching(/tier 3/i) })
  })
  it("rejects a leading blank row", () => {
    expect(parseTiers(fd(["", "120"]))).toEqual({ error: expect.stringMatching(/tier 2/i) })
  })
})
