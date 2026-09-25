import { signedCents, withRunningBalance, generateGeneralLedgerCsv, type GLRow } from "@/lib/generalLedgerExport"

const d = (s: string) => new Date(s)

describe("signedCents", () => {
  it("income is positive cents", () => {
    expect(signedCents("INCOME", "12.34")).toBe(1234)
  })
  it("expense is negative cents", () => {
    expect(signedCents("EXPENSE", "12.34")).toBe(-1234)
  })
})

describe("withRunningBalance", () => {
  it("accumulates signed cents in order, starting at 0", () => {
    const rows: GLRow[] = [
      { date: d("2025-07-01"), description: "a", reference: null, type: "INCOME", amount: "100.00" },
      { date: d("2025-07-08"), description: "b", reference: "R1", type: "EXPENSE", amount: "40.00" },
      { date: d("2025-07-15"), description: "c", reference: null, type: "INCOME", amount: "10.00" },
    ]
    expect(withRunningBalance(rows).map((r) => r.balanceCents)).toEqual([10000, 6000, 7000])
  })
  it("returns [] for empty input", () => {
    expect(withRunningBalance([])).toEqual([])
  })
})

describe("generateGeneralLedgerCsv", () => {
  it("emits header + one row per entry with signed amount and running balance", () => {
    const rows = withRunningBalance([
      { date: d("2025-07-01"), description: "Sunday collection", reference: "DEP1", type: "INCOME", amount: "100.00" },
      { date: d("2025-07-08"), description: "Candles", reference: null, type: "EXPENSE", amount: "40.00" },
    ])
    const csv = generateGeneralLedgerCsv(rows)
    const lines = csv.split("\n")
    expect(lines[0]).toBe("Date,Description,Reference,Type,Amount,Running Balance")
    expect(lines[1]).toBe("01/07/2025,Sunday collection,DEP1,INCOME,100.00,100.00")
    // a plain negative amount stays numeric — escapeCsv only quote-prefixes
    // non-numeric formula-injection triggers, not bare numbers
    expect(lines[2]).toBe("08/07/2025,Candles,,EXPENSE,-40.00,60.00")
  })
})
