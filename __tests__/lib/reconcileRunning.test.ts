import { computeRunningBalances } from "@/lib/reconcileRunning"

describe("computeRunningBalances", () => {
  it("returns an empty array for no rows", () => {
    expect(computeRunningBalances([], 10_000)).toEqual([])
  })

  it("adds income and subtracts expense cumulatively from the start balance", () => {
    const rows = [
      { type: "INCOME" as const, amountCents: 5_000 },
      { type: "EXPENSE" as const, amountCents: 2_000 },
      { type: "INCOME" as const, amountCents: 1_000 },
    ]
    // start 10000 → 15000 → 13000 → 14000 (balance AFTER each row)
    expect(computeRunningBalances(rows, 10_000)).toEqual([15_000, 13_000, 14_000])
  })

  it("handles a negative running balance (overdrawn)", () => {
    const rows = [{ type: "EXPENSE" as const, amountCents: 3_000 }]
    expect(computeRunningBalances(rows, 1_000)).toEqual([-2_000])
  })

  it("does not mutate the input rows", () => {
    const rows = [{ type: "INCOME" as const, amountCents: 500 }]
    const snapshot = JSON.parse(JSON.stringify(rows))
    computeRunningBalances(rows, 0)
    expect(rows).toEqual(snapshot)
  })
})
