import {
  DEFAULT_VARIANCE_THRESHOLD_PCT,
  isOverVarianceThreshold,
  parseVarianceThreshold,
} from "@/lib/reports/budgetVarianceHelpers"

describe("isOverVarianceThreshold", () => {
  it("does not flag a variance under the threshold", () => {
    // $50 variance on a $1000 budget = 5%, under the 10% default.
    expect(isOverVarianceThreshold(50, 1000, 10)).toBe(false)
  })

  it("flags a variance over the threshold", () => {
    // $150 variance on a $1000 budget = 15%, over the 10% threshold.
    expect(isOverVarianceThreshold(150, 1000, 10)).toBe(true)
  })

  it("does not flag a variance exactly at the threshold", () => {
    // $100 variance on a $1000 budget = exactly 10% — "exceeds" is strict >.
    expect(isOverVarianceThreshold(100, 1000, 10)).toBe(false)
  })

  it("flags based on magnitude regardless of direction (favorable or not)", () => {
    // -$150 on a $1000 budget = -15%, magnitude still over threshold.
    expect(isOverVarianceThreshold(-150, 1000, 10)).toBe(true)
  })

  it("never flags a zero budget line (percentage is undefined)", () => {
    expect(isOverVarianceThreshold(500, 0, 10)).toBe(false)
  })

  it("defaults to DEFAULT_VARIANCE_THRESHOLD_PCT when no threshold is passed", () => {
    expect(isOverVarianceThreshold(150, 1000)).toBe(true)
    expect(DEFAULT_VARIANCE_THRESHOLD_PCT).toBe(10)
  })
})

describe("parseVarianceThreshold", () => {
  it("returns the default when given undefined", () => {
    expect(parseVarianceThreshold(undefined)).toBe(DEFAULT_VARIANCE_THRESHOLD_PCT)
  })

  it("parses a valid numeric string", () => {
    expect(parseVarianceThreshold("15")).toBe(15)
  })

  it("parses a valid decimal string", () => {
    expect(parseVarianceThreshold("7.5")).toBe(7.5)
  })

  it("falls back to the default for a non-numeric string", () => {
    expect(parseVarianceThreshold("abc")).toBe(DEFAULT_VARIANCE_THRESHOLD_PCT)
  })

  it("falls back to the default for a negative value", () => {
    expect(parseVarianceThreshold("-5")).toBe(DEFAULT_VARIANCE_THRESHOLD_PCT)
  })

  it("falls back to the default for zero", () => {
    expect(parseVarianceThreshold("0")).toBe(DEFAULT_VARIANCE_THRESHOLD_PCT)
  })
})
