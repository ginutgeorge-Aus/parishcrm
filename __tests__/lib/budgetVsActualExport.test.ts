import { generateBudgetVsActualCsv, type BudgetVsActualRow } from "@/lib/reports/budgetVsActualExport"

describe("generateBudgetVsActualCsv", () => {
  it("emits header, account rows with variance/%, and section + net totals", () => {
    const rows: BudgetVsActualRow[] = [
      { code: "4001", name: "Sunday Collection", groupName: "Offerings", type: "INCOME", budgetCents: 100000, actualCents: 120000 },
      { code: "5001", name: "Candles", groupName: "Worship", type: "EXPENSE", budgetCents: 50000, actualCents: 40000 },
    ]
    const csv = generateBudgetVsActualCsv(rows, {
      incomeBudgetCents: 100000,
      incomeActualCents: 120000,
      expenseBudgetCents: 50000,
      expenseActualCents: 40000,
      netBudgetCents: 50000,
      netActualCents: 80000,
    })
    const lines = csv.split("\n")
    expect(lines[0]).toBe("Section,Group,Code,Account,Budget,Actual,Variance,Variance %")
    expect(lines[1]).toBe("Income,Offerings,4001,Sunday Collection,1000.00,1200.00,200.00,20.0")
    // negative variance/% get the formula-injection guard prefix from escapeCsv
    expect(lines[2]).toBe("Expenses,Worship,5001,Candles,500.00,400.00,-100.00,-20.0")
    expect(lines[3]).toBe(",,,Total Income,1000.00,1200.00,200.00,20.0")
    expect(lines[4]).toBe(",,,Total Expenses,500.00,400.00,-100.00,-20.0")
    expect(lines[5]).toBe(",,,Net,500.00,800.00,300.00,60.0")
  })

  it("blanks variance/% when no budget is set, and escapes negatives", () => {
    const rows: BudgetVsActualRow[] = [
      { code: "5002", name: "Unbudgeted expense", groupName: "Misc", type: "EXPENSE", budgetCents: null, actualCents: 10000 },
    ]
    const csv = generateBudgetVsActualCsv(rows, {
      incomeBudgetCents: 0,
      incomeActualCents: 0,
      expenseBudgetCents: 0,
      expenseActualCents: 10000,
      netBudgetCents: 0,
      netActualCents: -10000,
    })
    const lines = csv.split("\n")
    expect(lines[1]).toBe("Expenses,Misc,5002,Unbudgeted expense,,100.00,,")
    // net variance negative -> escapeCsv prefix
    expect(lines[4]).toBe(",,,Net,0.00,-100.00,-100.00,")
  })
})
