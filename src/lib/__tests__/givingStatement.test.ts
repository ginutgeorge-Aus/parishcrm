import { buildStatements, buildStatementModel, parseStatementYear, UNALLOCATED_FUND } from "@/lib/givingStatement"

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe("buildStatements", () => {
  it("groups by family, sums cents exactly and totals by fund", () => {
    const out = buildStatements([
      { date: d("2025-08-10"), description: "b", amount: "0.10", fundName: "Building", familyId: 1 },
      { date: d("2025-07-02"), description: "a", amount: "0.20", fundName: "Building", familyId: 1 },
      { date: d("2025-09-01"), description: "c", amount: 50, fundName: null, familyId: 1 },
      { date: d("2025-09-01"), description: "d", amount: 5, fundName: "Alms", familyId: 2 },
    ])
    expect(out.size).toBe(2)
    const f1 = out.get(1)!
    expect(f1.totalCents).toBe(5030)
    expect(f1.lines.map((l) => l.description)).toEqual(["a", "b", "c"])
    expect(f1.byFund).toEqual([
      { fund: "Building", cents: 30 },
      { fund: UNALLOCATED_FUND, cents: 5000 },
    ])
    expect(out.get(2)!.totalCents).toBe(500)
  })

  it("returns no statements for no gifts", () => {
    expect(buildStatements([]).size).toBe(0)
  })
})

describe("buildStatementModel", () => {
  it("formats totals, fund rows and the FY period", () => {
    const s = buildStatements([{ date: d("2025-08-10"), description: "x", amount: 1234.5, fundName: "Alms", familyId: 1 }]).get(1)!
    const m = buildStatementModel(s, "Smith", 2025, { name: "Church", abn: "1", address: "a", email: "e@x.com" }, d("2026-07-05"))
    expect(m.totalLabel).toBe("$1,234.50")
    expect(m.byFund).toEqual([{ fund: "Alms", amountLabel: "$1,234.50" }])
    expect(m.lines[0].dateLabel).toBe("10/08/2025")
    expect(m.periodLabel).toBe("1 July 2025 to 30 June 2026")
    expect(m.fyLabel).toBe("2025–26")
  })
})

describe("parseStatementYear", () => {
  it.each([["abc"], [""], [null], [undefined], ["1999"], ["2999"]])("rejects %p", (v) => {
    expect(parseStatementYear(v)).toBeNull()
  })
  it("accepts a plausible year", () => {
    expect(parseStatementYear("2025")).toBe(2025)
    expect(parseStatementYear(2024)).toBe(2024)
  })
})
