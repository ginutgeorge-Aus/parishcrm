import {
  computeRiskFlags,
  hasRiskFlags,
  LARGE_AMOUNT_THRESHOLD_CENTS,
  BACKDATED_DAYS_THRESHOLD,
  SENSITIVE_CHANGE_TOLERANCE_MS,
  type RiskFlaggable,
} from "@/lib/reports/riskFlags"

const BASE_DATE = new Date("2026-06-01T00:00:00.000Z")

function makeTx(overrides: Partial<RiskFlaggable> = {}): RiskFlaggable {
  return {
    amount: "100.00",
    date: BASE_DATE,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    ...overrides,
  }
}

function flagTypes(tx: RiskFlaggable): string[] {
  return computeRiskFlags(tx).map((f) => f.type)
}

describe("computeRiskFlags — large amount", () => {
  it("does not flag an amount below the threshold", () => {
    expect(flagTypes(makeTx({ amount: "4999.99" }))).not.toContain("LARGE_AMOUNT")
  })

  it("flags an amount exactly at the threshold", () => {
    expect(flagTypes(makeTx({ amount: (LARGE_AMOUNT_THRESHOLD_CENTS / 100).toFixed(2) }))).toContain(
      "LARGE_AMOUNT"
    )
  })

  it("flags an amount above the threshold", () => {
    expect(flagTypes(makeTx({ amount: "10000.00" }))).toContain("LARGE_AMOUNT")
  })

  it("handles a Prisma Decimal-like object", () => {
    expect(flagTypes(makeTx({ amount: { toString: () => "5000.00" } }))).toContain("LARGE_AMOUNT")
  })
})

describe("computeRiskFlags — backdated", () => {
  it("does not flag a transaction entered the same day", () => {
    expect(flagTypes(makeTx())).not.toContain("BACKDATED")
  })

  it("does not flag exactly at the threshold boundary", () => {
    const createdAt = new Date(BASE_DATE.getTime() + BACKDATED_DAYS_THRESHOLD * 24 * 60 * 60 * 1000)
    expect(flagTypes(makeTx({ createdAt }))).not.toContain("BACKDATED")
  })

  it("flags a transaction entered just past the threshold", () => {
    const createdAt = new Date(
      BASE_DATE.getTime() + (BACKDATED_DAYS_THRESHOLD * 24 * 60 * 60 * 1000 + 1)
    )
    expect(flagTypes(makeTx({ createdAt }))).toContain("BACKDATED")
  })

  it("does not flag when createdAt precedes the transaction date", () => {
    const createdAt = new Date(BASE_DATE.getTime() - 60 * 24 * 60 * 60 * 1000)
    expect(flagTypes(makeTx({ createdAt }))).not.toContain("BACKDATED")
  })
})

describe("computeRiskFlags — sensitive change", () => {
  it("does not flag within the tolerance window", () => {
    const updatedAt = new Date(BASE_DATE.getTime() + SENSITIVE_CHANGE_TOLERANCE_MS)
    expect(flagTypes(makeTx({ updatedAt }))).not.toContain("SENSITIVE_CHANGE")
  })

  it("flags just past the tolerance window", () => {
    const updatedAt = new Date(BASE_DATE.getTime() + SENSITIVE_CHANGE_TOLERANCE_MS + 1)
    expect(flagTypes(makeTx({ updatedAt }))).toContain("SENSITIVE_CHANGE")
  })

  it("flags a clearly later edit", () => {
    const updatedAt = new Date(BASE_DATE.getTime() + 24 * 60 * 60 * 1000)
    expect(flagTypes(makeTx({ updatedAt }))).toContain("SENSITIVE_CHANGE")
  })
})

describe("computeRiskFlags — combinations", () => {
  it("returns no flags for an unremarkable transaction", () => {
    expect(computeRiskFlags(makeTx())).toEqual([])
  })

  it("returns multiple flags in a stable order when several apply", () => {
    const tx = makeTx({
      amount: "10000.00",
      createdAt: new Date(BASE_DATE.getTime() + 40 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(BASE_DATE.getTime() + 41 * 24 * 60 * 60 * 1000),
    })
    expect(flagTypes(tx)).toEqual(["LARGE_AMOUNT", "BACKDATED", "SENSITIVE_CHANGE"])
  })

  it("each flag carries a human-readable label and description", () => {
    const flags = computeRiskFlags(makeTx({ amount: "10000.00" }))
    expect(flags[0].label).toBe("Large amount")
    expect(flags[0].description.length).toBeGreaterThan(0)
  })
})

describe("hasRiskFlags", () => {
  it("is false when no flags apply", () => {
    expect(hasRiskFlags(makeTx())).toBe(false)
  })

  it("is true when at least one flag applies", () => {
    expect(hasRiskFlags(makeTx({ amount: "10000.00" }))).toBe(true)
  })
})
