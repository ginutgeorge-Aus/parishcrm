/** @jest-environment node */
import * as React from "react"
import { render } from "@react-email/render"
import { ReceiptEmail } from "@/lib/emails/ReceiptEmail"
import type { ReceiptData } from "@/lib/emails/ReceiptEmail"

const sample: ReceiptData = {
  transactionId: 42, date: "15/05/2026", description: "Sunday Offering", amount: "$500.00",
  type: "INCOME", account: "4001 — Sunday Offering", churchName: "Example Church",
  churchAddress: "123 Example St, Sydney NSW 2000", churchAbn: "12 345 678 901", churchEmail: "church@gmail.com",
}
const signoff = "This is an official receipt. Please retain for your records."
const html = (d: ReceiptData) => render(<ReceiptEmail data={d} intro="" signoff={signoff} />)

describe("ReceiptEmail", () => {
  it("contains receipt number, church, amount, description, ABN, address", async () => {
    const h = await html(sample)
    expect(h).toContain("42")
    expect(h).toContain("Example Church")
    expect(h).toContain("$500.00")
    expect(h).toContain("Sunday Offering")
    expect(h).toContain("12 345 678 901")
    expect(h).toContain("123 Example St, Sydney NSW 2000")
  })
  it("omits reference row when not provided; includes when provided", async () => {
    expect(await html(sample)).not.toContain("Reference")
    expect(await html({ ...sample, reference: "REF-001" })).toContain("REF-001")
  })
  it("includes family name when provided", async () => {
    expect(await html({ ...sample, familyName: "Smith Family" })).toContain("Smith Family")
  })
  it("renders valid HTML document", async () => {
    const h = await html(sample)
    expect(h).toMatch(/^<!DOCTYPE html/)
    expect(h).toContain("</html>")
  })
  it("produces a plain-text variant with the amount", async () => {
    const t = await render(<ReceiptEmail data={sample} intro="" signoff={signoff} />, { plainText: true })
    expect(t).toContain("$500.00")
  })
  it("renders INCOME in green and EXPENSE in red", async () => {
    const income = await html(sample)
    expect(income).toContain("#16a34a")
    expect(income).toContain("Income")
    const expense = await html({ ...sample, type: "EXPENSE" })
    expect(expense).toContain("#dc2626")
    expect(expense).toContain("Expense")
  })
  it("contains church email in footer", async () => {
    expect(await html(sample)).toContain("church@gmail.com")
  })
  it("contains official receipt line", async () => {
    expect(await html(sample)).toContain("official receipt")
  })
})
