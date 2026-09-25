import { computeFamilyWaiver } from "@/lib/eventWaiver"

describe("computeFamilyWaiver", () => {
  const line = (unitPriceCents: number, quantity: number, countsTowardWaiver = true) =>
    ({ unitPriceCents, quantity, countsTowardWaiver })

  it("no-op when disabled", () => {
    expect(computeFamilyWaiver([line(1000, 6)], { enabled: false, threshold: 4 }))
      .toEqual({ freeCount: 0, discountCents: 0 })
  })

  it("no waiver at or below threshold", () => {
    expect(computeFamilyWaiver([line(1000, 4)], { enabled: true, threshold: 4 }))
      .toEqual({ freeCount: 0, discountCents: 0 })
  })

  it("frees one when one over threshold", () => {
    // 5 attendees @ $10, threshold 4 → 1 free = 1000 cents
    expect(computeFamilyWaiver([line(1000, 5)], { enabled: true, threshold: 4 }))
      .toEqual({ freeCount: 1, discountCents: 1000 })
  })

  it("frees the cheapest counted units first across ticket types", () => {
    // 4 adult @ $20 + 3 child @ $10 = 7 counted, threshold 4 → 3 free.
    // Cheapest first: 3 child freed = 3 * 1000 = 3000 cents.
    const res = computeFamilyWaiver(
      [line(2000, 4), line(1000, 3)],
      { enabled: true, threshold: 4 },
    )
    expect(res).toEqual({ freeCount: 3, discountCents: 3000 })
  })

  it("spills into the next-cheapest type when the cheapest runs out", () => {
    // 5 adult @ $20 + 1 child @ $10 = 6 counted, threshold 4 → 2 free.
    // Free the 1 child ($10) then 1 adult ($20) = 1000 + 2000 = 3000 cents.
    const res = computeFamilyWaiver(
      [line(2000, 5), line(1000, 1)],
      { enabled: true, threshold: 4 },
    )
    expect(res).toEqual({ freeCount: 2, discountCents: 3000 })
  })

  it("excludes non-counted (Visitor) units from count and discount", () => {
    // 5 member @ $10 (counts) + 3 visitor @ $25 (excluded), threshold 4.
    // Counted = 5 → 1 free @ $10 = 1000. Visitors untouched.
    const res = computeFamilyWaiver(
      [line(1000, 5, true), line(2500, 3, false)],
      { enabled: true, threshold: 4 },
    )
    expect(res).toEqual({ freeCount: 1, discountCents: 1000 })
  })

  it("threshold 0 frees all counted units", () => {
    expect(computeFamilyWaiver([line(1000, 3)], { enabled: true, threshold: 0 }))
      .toEqual({ freeCount: 3, discountCents: 3000 })
  })

  it("no-op when nothing counts", () => {
    expect(computeFamilyWaiver([line(1000, 9, false)], { enabled: true, threshold: 4 }))
      .toEqual({ freeCount: 0, discountCents: 0 })
  })
})
