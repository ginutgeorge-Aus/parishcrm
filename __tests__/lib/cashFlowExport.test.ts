import { generateCashFlowCsv, type CashFlowOperatingRow, type CashFlowPositionRow } from "@/lib/reports/cashFlowExport"

describe("generateCashFlowCsv", () => {
  it("emits both sections with headers, rows, and totals", () => {
    const operating: CashFlowOperatingRow[] = [
      { direction: "IN", groupName: "Offerings", amountCents: 100000 },
      { direction: "OUT", groupName: "Utilities", amountCents: 40000 },
    ]
    const positions: CashFlowPositionRow[] = [
      { label: "ANZ Church", openingCents: 500000, inCents: 100000, outCents: 40000, closingCents: 560000 },
      { label: "Petty Cash", openingCents: null, inCents: null, outCents: null, closingCents: null },
    ]
    const csv = generateCashFlowCsv(
      operating,
      { cashInCents: 100000, cashOutCents: 40000, netMovementCents: 60000 },
      positions,
      560000,
    )
    const lines = csv.split("\n")
    expect(lines[0]).toBe("Operating Activities")
    expect(lines[1]).toBe("Category,Group,Amount")
    expect(lines[2]).toBe("Cash In,Offerings,1000.00")
    expect(lines[3]).toBe("Cash Out,Utilities,400.00")
    expect(lines[4]).toBe("Cash In,Total,1000.00")
    expect(lines[5]).toBe("Cash Out,Total,400.00")
    expect(lines[6]).toBe("Net Cash Movement,,600.00")
    expect(lines[7]).toBe("")
    expect(lines[8]).toBe("Cash Position by Account")
    expect(lines[9]).toBe("Account,Opening,In,Out,Closing")
    expect(lines[10]).toBe("ANZ Church,5000.00,1000.00,400.00,5600.00")
    expect(lines[11]).toBe("Petty Cash,,,,")
    expect(lines[12]).toBe("Total,,,,5600.00")
  })

  it("escapes negative amounts and formula-like group names", () => {
    const operating: CashFlowOperatingRow[] = [{ direction: "OUT", groupName: "=cmd", amountCents: 1000 }]
    const csv = generateCashFlowCsv(
      operating,
      { cashInCents: 0, cashOutCents: 1000, netMovementCents: -1000 },
      [],
      null,
    )
    const lines = csv.split("\n")
    expect(lines[2]).toBe("Cash Out,'=cmd,10.00")
    expect(lines[5]).toBe("Net Cash Movement,,-10.00")
    // no positions -> total row still emitted with blank total
    expect(csv).toContain("Total,,,,")
  })
})
