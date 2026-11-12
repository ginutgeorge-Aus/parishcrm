import { entryTotals, fundraiserTotals } from "@/lib/fundraiserMath"

describe("entryTotals", () => {
  const entry = { quantity: 3, unitPrice: "10.00" }

  it("is UNPAID with no payments", () => {
    expect(entryTotals(entry, [])).toEqual({
      owedCents: 3000, paidCents: 0, remainingCents: 3000, status: "UNPAID",
    })
  })
  it("is PART when partly paid", () => {
    expect(entryTotals(entry, [{ amount: "10.00" }])).toEqual({
      owedCents: 3000, paidCents: 1000, remainingCents: 2000, status: "PART",
    })
  })
  it("is PAID when fully paid", () => {
    const r = entryTotals(entry, [{ amount: "10.00" }, { amount: 20 }])
    expect(r).toEqual({ owedCents: 3000, paidCents: 3000, remainingCents: 0, status: "PAID" })
  })
  it("is OVERPAID with remaining 0 when paid exceeds owed", () => {
    const r = entryTotals(entry, [{ amount: { toString: () => "35.00" } }])
    expect(r).toEqual({ owedCents: 3000, paidCents: 3500, remainingCents: 0, status: "OVERPAID" })
  })
})

describe("fundraiserTotals", () => {
  it("sums expected, collected and outstanding", () => {
    const e = { quantity: 3, unitPrice: "10.00" }
    const rows = [
      entryTotals(e, []),
      entryTotals(e, [{ amount: "10.00" }]),
      entryTotals(e, [{ amount: "35.00" }]),
    ]
    expect(fundraiserTotals(rows)).toEqual({
      expectedCents: 9000, collectedCents: 4500, outstandingCents: 5000,
    })
  })
  it("returns zeros for no rows", () => {
    expect(fundraiserTotals([])).toEqual({ expectedCents: 0, collectedCents: 0, outstandingCents: 0 })
  })
})
