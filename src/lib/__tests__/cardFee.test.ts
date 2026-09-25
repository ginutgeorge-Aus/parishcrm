import { grossUpTotal } from "@/lib/cardFee"

describe("grossUpTotal (1.7% + 30c)", () => {
  it("grosses up $50 so net is recovered after Stripe's cut", () => {
    const { totalCents, feeCents } = grossUpTotal(5000, 1.7, 30)
    expect(totalCents).toBe(5117) // (5000+30)/(1-0.017) = 5116.99 -> 5117
    expect(feeCents).toBe(117)
    // Church nets >= ticket after Stripe takes pct + fixed from the gross:
    const stripeCut = Math.round(totalCents * 0.017) + 30
    expect(totalCents - stripeCut).toBeGreaterThanOrEqual(5000)
  })

  it("grosses up $100", () => {
    expect(grossUpTotal(10000, 1.7, 30)).toEqual({ totalCents: 10203, feeCents: 203 })
  })

  it("grosses up $10 (fixed fee dominates)", () => {
    expect(grossUpTotal(1000, 1.7, 30)).toEqual({ totalCents: 1048, feeCents: 48 })
  })

  it("returns zero fee for a zero (free / fully-waived) net", () => {
    expect(grossUpTotal(0, 1.7, 30)).toEqual({ totalCents: 0, feeCents: 0 })
  })
})
