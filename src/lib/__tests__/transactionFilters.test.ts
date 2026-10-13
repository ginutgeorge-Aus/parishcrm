import {
  transactionListHref,
  transactionListQuery,
  monthOptions,
  monthRange,
  monthFromRange,
} from "@/lib/transactionFilters"

describe("transactionListQuery", () => {
  it("keeps only known filter keys with non-empty string values", () => {
    expect(
      transactionListQuery({ from: "2026-01-01", type: "INCOME", evil: "x", q: "", page: "2" })
    ).toBe("from=2026-01-01&type=INCOME&page=2")
  })

  it("accepts a raw query string", () => {
    expect(transactionListQuery("account=3&next=https://evil.example&fund=1")).toBe("account=3&fund=1")
  })

  it("returns empty for undefined / non-string input", () => {
    expect(transactionListQuery(undefined)).toBe("")
    expect(transactionListQuery({ from: ["a", "b"] as unknown as string })).toBe("")
  })
})

describe("transactionListHref", () => {
  it("always targets the transactions list path", () => {
    expect(transactionListHref("from=2026-01-01&to=2026-01-31")).toBe(
      "/accounting/transactions?from=2026-01-01&to=2026-01-31"
    )
    expect(transactionListHref("//evil.example")).toBe("/accounting/transactions")
    expect(transactionListHref(undefined)).toBe("/accounting/transactions")
  })
})

describe("monthOptions", () => {
  it("lists every month from the earliest transaction to now, newest first", () => {
    const opts = monthOptions(new Date("2025-11-15T00:00:00Z"), new Date("2026-01-03T00:00:00Z"), { year: 2026, month: 2 })
    expect(opts.map((o) => o.value)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"])
    expect(opts[0].label).toBe("February 2026")
  })

  it("falls back to the current month when there are no transactions", () => {
    expect(monthOptions(null, null, { year: 2026, month: 10 }).map((o) => o.value)).toEqual(["2026-10"])
  })

  it("extends to future-dated transactions", () => {
    const opts = monthOptions(new Date("2026-10-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z"), { year: 2026, month: 10 })
    expect(opts.map((o) => o.value)).toEqual(["2026-12", "2026-11", "2026-10"])
  })
})

describe("monthRange / monthFromRange", () => {
  it("maps a month to its first and last day", () => {
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" })
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" })
    expect(monthRange("bad")).toBeNull()
    expect(monthRange("2026-13")).toBeNull()
  })

  it("recognises a whole-month from/to pair", () => {
    expect(monthFromRange("2024-02-01", "2024-02-29")).toBe("2024-02")
    expect(monthFromRange("2024-02-01", "2024-02-28")).toBe("")
    expect(monthFromRange("", "")).toBe("")
  })
})
