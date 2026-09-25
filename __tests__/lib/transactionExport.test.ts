import { generateTransactionCsv } from "@/lib/transactionExport"

type Row = Parameters<typeof generateTransactionCsv>[0][0]

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    date: new Date("2026-03-15"),
    description: "Tithe offering",
    account: { code: "4001", name: "Tithes" },
    type: "INCOME",
    amount: "500.00",
    paymentAccountName: null,
    family: null,
    person: null,
    reference: null,
    notes: null,
    reconciled: false,
    ...overrides,
  }
}

function getCol(csv: string, colName: string): string {
  const headers = csv.split("\n")[0].split(",")
  const idx = headers.indexOf(colName)
  if (idx === -1) throw new Error(`Column "${colName}" not found in headers`)
  const dataRow = csv.split("\n")[1]
  if (!dataRow) throw new Error("No data row")
  return dataRow.split(",")[idx]
}

describe("generateTransactionCsv", () => {
  it("generates correct header row", () => {
    const csv = generateTransactionCsv([])
    const header = csv.split("\n")[0]
    expect(header).toBe(
      "Date,Description,Category Code,Category Name,Type,Amount,Payment Account,Family,Person,Reference,Notes,Reconciled"
    )
  })

  it("formats date as DD/MM/YYYY", () => {
    const csv = generateTransactionCsv([makeRow({ date: new Date("2026-03-15") })])
    expect(csv.split("\n")[1]).toContain("15/03/2026")
  })

  it("formats amount as 2 decimal places", () => {
    const csv = generateTransactionCsv([makeRow({ amount: "500" })])
    expect(csv.split("\n")[1]).toContain("500.00")
  })

  // paymentAccountName is the already-resolved PaymentAccount.name (FK, not an
  // enum) — the caller fetches the account and passes its display name
  // straight through, so this module just renders it verbatim.
  it("passes paymentAccountName straight through", () => {
    const csv = generateTransactionCsv([makeRow({ paymentAccountName: "ANZ Church" })])
    expect(csv.split("\n")[1]).toContain("ANZ Church")
  })

  it("uses blank for null paymentAccountName", () => {
    const csv = generateTransactionCsv([makeRow({ paymentAccountName: null })])
    expect(getCol(csv, "Payment Account")).toBe("")
  })

  it("uses blank for null family", () => {
    const csv = generateTransactionCsv([makeRow({ family: null })])
    expect(getCol(csv, "Family")).toBe("")
  })

  it("concatenates person firstName and lastName", () => {
    const csv = generateTransactionCsv([
      makeRow({ person: { firstName: "John", lastName: "Doe" } }),
    ])
    expect(csv.split("\n")[1]).toContain("John Doe")
  })

  it("uses blank for null person", () => {
    const csv = generateTransactionCsv([makeRow({ person: null })])
    expect(getCol(csv, "Person")).toBe("")
  })

  it("renders reconciled=true as Yes", () => {
    const csv = generateTransactionCsv([makeRow({ reconciled: true })])
    expect(getCol(csv, "Reconciled")).toBe("Yes")
  })

  it("renders reconciled=false as No", () => {
    const csv = generateTransactionCsv([makeRow({ reconciled: false })])
    expect(getCol(csv, "Reconciled")).toBe("No")
  })

  it("prefixes formula-injection characters with '", () => {
    const csv = generateTransactionCsv([makeRow({ description: "=SUM(A1)" })])
    expect(csv.split("\n")[1]).toContain("'=SUM(A1)")
  })

  it("also prefixes + - @ formula characters", () => {
    const plus = generateTransactionCsv([makeRow({ description: "+foo" })])
    const minus = generateTransactionCsv([makeRow({ description: "-foo" })])
    const at = generateTransactionCsv([makeRow({ description: "@foo" })])
    expect(plus.split("\n")[1]).toContain("'+foo")
    expect(minus.split("\n")[1]).toContain("'-foo")
    expect(at.split("\n")[1]).toContain("'@foo")
  })

  it("quotes cells containing commas", () => {
    const csv = generateTransactionCsv([makeRow({ description: "Offering, special" })])
    expect(csv.split("\n")[1]).toContain('"Offering, special"')
  })

  it("returns only header row for empty input", () => {
    const csv = generateTransactionCsv([])
    expect(csv.split("\n").length).toBe(1)
  })
})
