import { generateBalanceSheetCsv, type BalanceSheetRow } from "@/lib/reports/balanceSheetExport"

const d = (s: string) => new Date(s)

describe("generateBalanceSheetCsv", () => {
  it("emits header, one row per account, and a total row", () => {
    const rows: BalanceSheetRow[] = [
      {
        label: "ANZ Church",
        openingCents: 500000,
        openingAsOf: d("2025-07-01"),
        incomeCents: 100000,
        expenseCents: 40000,
        balanceCents: 560000,
      },
      { label: "Petty Cash", openingCents: null, openingAsOf: null, incomeCents: null, expenseCents: null, balanceCents: null },
    ]
    const csv = generateBalanceSheetCsv(rows, 560000)
    const lines = csv.split("\n")
    expect(lines[0]).toBe("Account,Opening Balance,Opening As Of,Income,Expenses,Balance")
    expect(lines[1]).toBe("ANZ Church,5000.00,01/07/2025,1000.00,400.00,5600.00")
    expect(lines[2]).toBe("Petty Cash,,,,,")
    expect(lines[3]).toBe("Total,,,,,5600.00")
  })

  it("escapes negative balances and blanks a null grand total", () => {
    const rows: BalanceSheetRow[] = [
      { label: "ANZ Tithe", openingCents: 0, openingAsOf: d("2025-07-01"), incomeCents: 0, expenseCents: 50000, balanceCents: -50000 },
    ]
    const csv = generateBalanceSheetCsv(rows, null)
    const lines = csv.split("\n")
    expect(lines[1]).toBe("ANZ Tithe,0.00,01/07/2025,0.00,500.00,-500.00")
    expect(lines[2]).toBe("Total,,,,,")
  })
})
