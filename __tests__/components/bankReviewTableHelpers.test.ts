/**
 * Unit tests for the pure helpers in bankSplit:
 * toCents / isSplit / splitIsValid. These drive the split-import money maths
 * and the confirm-enable gate, so a float-drift or sum-mismatch regression here
 * would silently let an unbalanced split through the UI.
 */
import { toCents, isSplit, splitIsValid } from "@/lib/bankSplit"

// Minimal ReviewRow factory — only the fields the helpers read matter.
const row = (overrides: Record<string, unknown> = {}) =>
  ({
    bankRef: "ANZ_1_20260101_60.00_x_0",
    date: "2026-01-01",
    description: "x",
    details: "x",
    type: "INCOME",
    familyId: null,
    personId: null,
    amount: "60.00",
    accountId: null,
    skip: false,
    isDuplicate: false,
    fromPettyCash: false,
    ...overrides,
  }) as Parameters<typeof splitIsValid>[0]

describe("toCents", () => {
  it("converts a 2dp amount string to integer cents", () => {
    expect(toCents("60.00")).toBe(6000)
    expect(toCents("0.05")).toBe(5)
    expect(toCents("1234.56")).toBe(123456)
  })

  it("rounds rather than truncating float drift (19.99 * 100)", () => {
    expect(toCents("19.99")).toBe(1999)
  })

  it("handles whole-dollar strings and zero", () => {
    expect(toCents("100")).toBe(10000)
    expect(toCents("0")).toBe(0)
  })
})

describe("isSplit", () => {
  it("is false with no splits, undefined splits, or an empty array", () => {
    expect(isSplit({})).toBe(false)
    expect(isSplit({ splits: undefined })).toBe(false)
    expect(isSplit({ splits: [] })).toBe(false)
  })

  it("is true once at least one split line exists", () => {
    expect(isSplit({ splits: [{ accountId: 1, familyId: null, personId: null, amount: "10.00" }] })).toBe(true)
  })
})

describe("splitIsValid", () => {
  const split = (accountId: number | null, amount: string) => ({ accountId, familyId: null, personId: null, amount })

  it("is false when there are no splits", () => {
    expect(splitIsValid(row({ splits: [] }))).toBe(false)
    expect(splitIsValid(row({ splits: undefined }))).toBe(false)
  })

  it("is true when every line has a category and lines sum exactly to the total", () => {
    expect(splitIsValid(row({ amount: "60.00", splits: [split(1, "40.00"), split(2, "20.00")] }))).toBe(true)
  })

  it("is false when any line is missing a category", () => {
    expect(splitIsValid(row({ amount: "60.00", splits: [split(null, "40.00"), split(2, "20.00")] }))).toBe(false)
  })

  it("is false when any line amount is zero or negative", () => {
    expect(splitIsValid(row({ amount: "60.00", splits: [split(1, "60.00"), split(2, "0.00")] }))).toBe(false)
  })

  it("is false when the lines do not sum to the row total", () => {
    expect(splitIsValid(row({ amount: "60.00", splits: [split(1, "40.00"), split(2, "19.99")] }))).toBe(false)
  })

  it("compares in integer cents so a float-representable shortfall is still rejected", () => {
    // 0.1 + 0.2 !== 0.3 in float; cents compare must still catch a 1c mismatch.
    expect(splitIsValid(row({ amount: "0.30", splits: [split(1, "0.10"), split(2, "0.19")] }))).toBe(false)
    expect(splitIsValid(row({ amount: "0.30", splits: [split(1, "0.10"), split(2, "0.20")] }))).toBe(true)
  })
})
