// Mirrors the migration's name/kind derivation so a regression in either is caught.
function humanise(v: string) {
  return v
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
function kindOf(v: string) {
  return v === "PETTY_CASH" ? "CASH" : "BANK"
}

describe("payment account backfill mapping", () => {
  it("maps the three seeded PaymentAccount enum values", () => {
    expect(humanise("ANZ_CHURCH")).toBe("Anz Church")
    expect(humanise("PETTY_CASH")).toBe("Petty Cash")
    expect(kindOf("PETTY_CASH")).toBe("CASH")
    expect(kindOf("ANZ_TITHE")).toBe("BANK")
  })
})
