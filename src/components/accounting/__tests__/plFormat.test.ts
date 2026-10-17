import { fmtGrid, makeFmtGrid, plTone, plTransactionsHref } from "@/components/accounting/plFormat"
import { APP_LOCALE } from "@/lib/appConfig"

// Expected strings follow APP_LOCALE so the suite passes under any configured locale.
const num = (n: number) =>
  new Intl.NumberFormat(APP_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

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

describe("fmtGrid", () => {
  it("formats cents without a currency symbol, dash for zero, parens for negatives", () => {
    expect(fmtGrid(0)).toBe("–")
    expect(fmtGrid(123456)).toBe(num(1234.56))
    expect(fmtGrid(-5000)).toBe(`(${num(50)})`)
  })
})

describe("makeFmtGrid", () => {
  it("follows the currency's fraction digits (JPY has none)", () => {
    const grid = makeFmtGrid("ja-JP", "JPY")
    expect(grid(123400)).toBe("1,234")
    expect(grid(-5000)).toBe("(50)")
  })

  it("follows the locale's separators and negative style, without the symbol", () => {
    const grid = makeFmtGrid("de-DE", "EUR")
    expect(grid(123456)).toBe("1.234,56")
    expect(grid(-5000)).toBe("-50,00")
    expect(grid(0)).toBe("–")
  })
})

describe("plTone", () => {
  it("classifies zero, positive and negative figures", () => {
    expect(plTone(0)).toBe("zero")
    expect(plTone(1)).toBe("positive")
    expect(plTone(-1)).toBe("negative")
  })
})
