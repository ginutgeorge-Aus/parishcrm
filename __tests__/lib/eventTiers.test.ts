import { parseTiers } from "@/lib/eventTiers"

function tierForm(prices: string[]) {
  const fd = new FormData()
  prices.forEach((p, i) => fd.set(`tier.${i}.price`, p))
  return fd
}

describe("parseTiers", () => {
  it("parses ordered, non-decreasing tiers", () => {
    expect(parseTiers(tierForm(["10", "18", "18", "25"]))).toEqual({ tiers: [10, 18, 18, 25] })
  })

  it("returns an empty tiers array when no tier fields are present", () => {
    expect(parseTiers(new FormData())).toEqual({ tiers: [] })
  })

  it("rejects a blank row between filled prices", () => {
    const fd = tierForm(["10", "", "25"])
    expect(parseTiers(fd)).toEqual({
      error: "Tier 3 follows a blank tier — remove blank rows between prices",
    })
  })

  it("rejects a malformed price", () => {
    expect(parseTiers(tierForm(["10", "not-a-number"]))).toEqual({ error: "Invalid price for tier 2" })
  })

  it("rejects more than the max tier rows", () => {
    const fd = tierForm(Array.from({ length: 21 }, (_, i) => String(10 + i)))
    expect(parseTiers(fd)).toEqual({ error: "Too many pricing tiers (max 20)" })
  })

  // a decreasing tier would let a larger family group pay less than a
  // smaller one for the same event, with nothing downstream to catch it.
  it("rejects a decreasing tier price", () => {
    const fd = tierForm(["50", "40"])
    expect(parseTiers(fd)).toEqual({
      error: "Tier 2 ($40) is less than tier 1 — prices must not decrease",
    })
  })

  it("rejects a decreasing tier further down the list", () => {
    const fd = tierForm(["10", "20", "30", "15"])
    expect(parseTiers(fd)).toEqual({
      error: "Tier 4 ($15) is less than tier 3 — prices must not decrease",
    })
  })

  it("accepts equal consecutive tier prices (flat pricing beyond a point)", () => {
    expect(parseTiers(tierForm(["20", "20", "20"]))).toEqual({ tiers: [20, 20, 20] })
  })
})
