import { generateTrialBalanceCsv, type TrialBalanceRow } from "@/lib/reports/trialBalanceExport"

describe("generateTrialBalanceCsv", () => {
  it("emits header, debit rows for expenses, credit rows for income, and total/net footer", () => {
    const rows: TrialBalanceRow[] = [
      { code: "5001", name: "Candles", groupName: "Worship", type: "EXPENSE", amountCents: 4000 },
      { code: "4001", name: "Sunday Collection", groupName: "Offerings", type: "INCOME", amountCents: 10000 },
    ]
    const csv = generateTrialBalanceCsv(rows, { totalDebitCents: 4000, totalCreditCents: 10000, netCents: 6000 })
    const lines = csv.split("\n")
    expect(lines[0]).toBe("Code,Account,Group,Debit,Credit")
    expect(lines[1]).toBe("5001,Candles,Worship,40.00,")
    expect(lines[2]).toBe("4001,Sunday Collection,Offerings,,100.00")
    expect(lines[3]).toBe(",Total,,40.00,100.00")
    expect(lines[4]).toBe(",Net surplus / (deficit),,,60.00")
  })

  it("escapes formula-injection-looking names and negative net", () => {
    const rows: TrialBalanceRow[] = [
      { code: "5002", name: "=SUM(A1)", groupName: "Other", type: "EXPENSE", amountCents: 10000 },
    ]
    const csv = generateTrialBalanceCsv(rows, { totalDebitCents: 10000, totalCreditCents: 0, netCents: -10000 })
    const lines = csv.split("\n")
    expect(lines[1]).toBe("5002,'=SUM(A1),Other,100.00,")
    expect(lines[3]).toBe(",Net surplus / (deficit),,,-100.00")
  })

  it("handles empty rows", () => {
    const csv = generateTrialBalanceCsv([], { totalDebitCents: 0, totalCreditCents: 0, netCents: 0 })
    const lines = csv.split("\n")
    expect(lines).toEqual(["Code,Account,Group,Debit,Credit", ",Total,,0.00,0.00", ",Net surplus / (deficit),,,0.00"])
  })
})
