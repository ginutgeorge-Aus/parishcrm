import { aggregateByFund } from "@/lib/reports/fundHelpers"

const rows = [
  { fundId: 1, type: "INCOME" as const, amount: "100.00" },
  { fundId: 1, type: "EXPENSE" as const, amount: "40.00" },
  { fundId: null, type: "INCOME" as const, amount: "10.00" },
]
const names = new Map<number, string>([[1, "Building"]])

describe("aggregateByFund", () => {
  it("aggregates income/expense/net per fund with a General bucket for null", () => {
    const out = aggregateByFund(rows, names)
    const building = out.find((r) => r.fundId === 1)!
    expect(building.incomeCents).toBe(10000)
    expect(building.expenseCents).toBe(4000)
    expect(building.netCents).toBe(6000)
    const general = out.find((r) => r.fundId === null)!
    expect(general.name).toBe("General (unassigned)")
    expect(general.incomeCents).toBe(1000)
  })

  it("sorts named funds first (by name), General bucket last", () => {
    const multi = [
      { fundId: 2, type: "INCOME" as const, amount: "5.00" },
      { fundId: 1, type: "INCOME" as const, amount: "5.00" },
      { fundId: null, type: "INCOME" as const, amount: "5.00" },
    ]
    const multiNames = new Map<number, string>([
      [1, "Zeta Fund"],
      [2, "Alpha Fund"],
    ])
    const out = aggregateByFund(multi, multiNames)
    expect(out.map((r) => r.name)).toEqual(["Alpha Fund", "Zeta Fund", "General (unassigned)"])
  })
})
