import {
  computeReconciliationEquation,
  centsToNumberOrNull,
} from "@/lib/reports/reconciliationEquation"

describe("computeReconciliationEquation", () => {
  test("computes calculated/adjusted/difference when all anchors are present", () => {
    const result = computeReconciliationEquation({
      openingCents: 10_000,
      clearedInCents: 5_000,
      clearedOutCents: 2_000,
      statementClosingCents: 13_000,
      outstandingDepositsCents: 500,
      outstandingPaymentsCents: 0,
    })
    // calculated = 10000 + 5000 - 2000 = 13000
    expect(result.calculatedCents).toBe(13_000)
    // adjusted = 13000 + 500 - 0 = 13500
    expect(result.adjustedCents).toBe(13_500)
    expect(result.differenceCents).toBe(13_000 - 13_500)
  })

  test("calculatedCents is null when there's no opening balance", () => {
    const result = computeReconciliationEquation({
      openingCents: null,
      clearedInCents: 100,
      clearedOutCents: 0,
      statementClosingCents: 100,
      outstandingDepositsCents: 0,
      outstandingPaymentsCents: 0,
    })
    expect(result.calculatedCents).toBeNull()
    expect(result.differenceCents).toBeNull()
  })

  test("adjustedCents is null when there's no saved statement", () => {
    const result = computeReconciliationEquation({
      openingCents: 100,
      clearedInCents: 0,
      clearedOutCents: 0,
      statementClosingCents: null,
      outstandingDepositsCents: 0,
      outstandingPaymentsCents: 0,
    })
    expect(result.adjustedCents).toBeNull()
    expect(result.differenceCents).toBeNull()
  })
})

describe("centsToNumberOrNull", () => {
  test("converts cents to dollars", () => {
    expect(centsToNumberOrNull(1234)).toBeCloseTo(12.34)
  })

  test("passes through null", () => {
    expect(centsToNumberOrNull(null)).toBeNull()
  })
})
