import { plTransactionsHref } from "@/components/accounting/plFormat"

// Default FY starts in July (APP_FY_START_MONTH unset in tests).
describe("plTransactionsHref", () => {
  it("links an account to its transactions for the whole FY", () => {
    expect(plTransactionsHref(12, 2025)).toBe(
      "/accounting/transactions?account=12&from=2025-07-01&to=2026-06-30",
    )
  })

  it("links to one FY month when a month index is given", () => {
    // index 0 = July of the FY's start year
    expect(plTransactionsHref(3, 2025, 0)).toBe(
      "/accounting/transactions?account=3&from=2025-07-01&to=2025-07-31",
    )
    // index 7 = February of the following calendar year (non-leap 2026)
    expect(plTransactionsHref(3, 2025, 7)).toBe(
      "/accounting/transactions?account=3&from=2026-02-01&to=2026-02-28",
    )
    // index 11 = June, last FY month
    expect(plTransactionsHref(3, 2025, 11)).toBe(
      "/accounting/transactions?account=3&from=2026-06-01&to=2026-06-30",
    )
  })

  it("handles a leap-year February", () => {
    expect(plTransactionsHref(3, 2023, 7)).toBe(
      "/accounting/transactions?account=3&from=2024-02-01&to=2024-02-29",
    )
  })

  it("rejects a month index outside 0–11", () => {
    expect(() => plTransactionsHref(3, 2025, 12)).toThrow(RangeError)
    expect(() => plTransactionsHref(3, 2025, -1)).toThrow(RangeError)
    expect(() => plTransactionsHref(3, 2025, 1.5)).toThrow(RangeError)
  })
})
