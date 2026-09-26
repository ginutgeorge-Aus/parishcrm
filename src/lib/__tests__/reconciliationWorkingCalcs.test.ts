import {
  resolveStatusFilter,
  statusWhereClause,
  isBeforeOpeningBalance,
  hasPeriodAnchor,
  computeBookBalance,
  shouldShowRunningBalance,
} from "@/lib/reports/reconciliationWorkingCalcs"

test("resolveStatusFilter accepts pending/reconciled, defaults to all", () => {
  expect(resolveStatusFilter("pending")).toBe("pending")
  expect(resolveStatusFilter("reconciled")).toBe("reconciled")
  expect(resolveStatusFilter("bogus")).toBe("all")
  expect(resolveStatusFilter(undefined)).toBe("all")
})

test("statusWhereClause maps filter to a reconciled where-clause", () => {
  expect(statusWhereClause("pending")).toEqual({ reconciled: false })
  expect(statusWhereClause("reconciled")).toEqual({ reconciled: true })
  expect(statusWhereClause("all")).toEqual({})
})

test("isBeforeOpeningBalance: true only when the window ends before the anchor", () => {
  const openingBalance = { asOfDate: new Date("2024-06-01T00:00:00Z") }
  expect(isBeforeOpeningBalance(openingBalance, new Date("2024-05-01"))).toBe(true)
  expect(isBeforeOpeningBalance(openingBalance, new Date("2024-07-01"))).toBe(false)
  expect(isBeforeOpeningBalance(null, new Date("2024-07-01"))).toBe(false)
})

test("hasPeriodAnchor requires an opening balance that isn't before the window", () => {
  expect(hasPeriodAnchor({ asOfDate: new Date() }, false)).toBe(true)
  expect(hasPeriodAnchor({ asOfDate: new Date() }, true)).toBe(false)
  expect(hasPeriodAnchor(null, false)).toBe(false)
})

describe("computeBookBalance", () => {
  test("null without an opening balance or anchor", () => {
    expect(computeBookBalance(null, true, 100, 0)).toBeNull()
    expect(computeBookBalance({ amount: 100 }, false, 100, 0)).toBeNull()
  })

  test("opening + income - expense, in dollars", () => {
    expect(computeBookBalance({ amount: 100 }, true, 50, 20)).toBeCloseTo(130)
  })
})

test("shouldShowRunningBalance requires an anchor, unfiltered status, and window on/after it", () => {
  const openingBalance = { asOfDate: new Date("2024-01-01T00:00:00Z") }
  expect(shouldShowRunningBalance(openingBalance, "all", new Date("2024-02-01"))).toBe(true)
  expect(shouldShowRunningBalance(openingBalance, "pending", new Date("2024-02-01"))).toBe(false)
  expect(shouldShowRunningBalance(openingBalance, "all", new Date("2023-12-01"))).toBe(false)
  expect(shouldShowRunningBalance(null, "all", new Date("2024-02-01"))).toBe(false)
})
