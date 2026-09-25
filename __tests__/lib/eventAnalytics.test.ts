import { fillRates, revenueByType, regsOverTime } from "@/lib/reports/eventAnalytics"

const reg = (createdAt: string, paymentStatus: string, items: { quantity: number; unitPrice: number; name: string }[]) => ({
  createdAt: new Date(createdAt),
  paymentStatus,
  items: items.map(i => ({ quantity: i.quantity, unitPrice: i.unitPrice, ticketType: { name: i.name } })),
})

describe("fillRates", () => {
  it("computes pct from sold/capacity", () => {
    expect(fillRates([{ name: "Adult", capacity: 100, registrationItems: [{ quantity: 30 }, { quantity: 20 }] }]))
      .toEqual([{ name: "Adult", sold: 50, capacity: 100, pct: 50 }])
  })
  it("returns pct null when capacity is null", () => {
    expect(fillRates([{ name: "Free", capacity: null, registrationItems: [{ quantity: 5 }] }]))
      .toEqual([{ name: "Free", sold: 5, capacity: null, pct: null }])
  })
  it("treats capacity 0 as null (no divide-by-zero)", () => {
    expect(fillRates([{ name: "X", capacity: 0, registrationItems: [{ quantity: 2 }] }]))
      .toEqual([{ name: "X", sold: 2, capacity: 0, pct: null }])
  })
  it("keeps real numbers when oversold (pct > 100)", () => {
    expect(fillRates([{ name: "X", capacity: 10, registrationItems: [{ quantity: 15 }] }]))
      .toEqual([{ name: "X", sold: 15, capacity: 10, pct: 150 }])
  })
  it("returns [] for no ticket types", () => {
    expect(fillRates([])).toEqual([])
  })
})

describe("revenueByType", () => {
  it("sums PAID only, excludes PENDING/CANCELLED", () => {
    const regs = [
      reg("2026-07-01", "PAID", [{ quantity: 2, unitPrice: 10, name: "Adult" }]),
      reg("2026-07-01", "PENDING", [{ quantity: 5, unitPrice: 10, name: "Adult" }]),
      reg("2026-07-01", "CANCELLED", [{ quantity: 5, unitPrice: 10, name: "Adult" }]),
    ]
    expect(revenueByType(regs)).toEqual([{ name: "Adult", revenue: 20 }])
  })
  it("groups multi-item registrations by ticket type", () => {
    const regs = [reg("2026-07-01", "PAID", [
      { quantity: 1, unitPrice: 10, name: "Adult" },
      { quantity: 2, unitPrice: 5, name: "Child" },
    ])]
    expect(revenueByType(regs)).toEqual([
      { name: "Adult", revenue: 10 },
      { name: "Child", revenue: 10 },
    ])
  })
  it("returns [] for no registrations", () => {
    expect(revenueByType([])).toEqual([])
  })
})

describe("regsOverTime", () => {
  it("collapses same-day regs and returns ascending cumulative", () => {
    const regs = [
      reg("2026-07-03", "PAID", []),
      reg("2026-07-01", "PENDING", []),
      reg("2026-07-01", "PAID", []),
    ]
    expect(regsOverTime(regs)).toEqual([
      { date: "2026-07-01", cumulative: 2 },
      { date: "2026-07-03", cumulative: 3 },
    ])
  })
  it("returns [] for no registrations", () => {
    expect(regsOverTime([])).toEqual([])
  })
  it("buckets by Sydney calendar date, not server-UTC date", () => {
    // 2026-03-01T15:00:00.000Z is 2am AEDT (+11) on 2026-03-02 in Sydney.
    const regs = [reg("2026-03-01T15:00:00.000Z", "PAID", [])]
    expect(regsOverTime(regs)).toEqual([{ date: "2026-03-02", cumulative: 1 }])
  })
})
