import { buildSessionWhere } from "@/lib/pettyCashSessionFilters"

describe("buildSessionWhere", () => {
  it("returns an empty filter when no params are set", () => {
    expect(buildSessionWhere({})).toEqual({})
  })

  it("keeps an allow-listed status and drops an unknown one", () => {
    expect(buildSessionWhere({ status: "OPEN" })).toEqual({ status: "OPEN" })
    expect(buildSessionWhere({ status: "FOO" })).toEqual({})
  })

  it("keeps a numeric custodian and drops a non-numeric one", () => {
    expect(buildSessionWhere({ custodian: "42" })).toEqual({ custodianId: 42 })
    expect(buildSessionWhere({ custodian: "abc" })).toEqual({})
  })

  it("builds an openedAt range with an end-of-day upper bound", () => {
    const where = buildSessionWhere({ from: "2026-07-01", to: "2026-07-31" })
    expect(where.openedAt?.gte).toEqual(new Date("2026-07-01"))
    expect(where.openedAt?.lte).toEqual(new Date("2026-07-31T23:59:59.999"))
  })

  it("keeps only the valid half of a date range", () => {
    expect(buildSessionWhere({ from: "notadate", to: "2026-07-31" })).toEqual({
      openedAt: { lte: new Date("2026-07-31T23:59:59.999") },
    })
    expect(buildSessionWhere({ from: "notadate", to: "alsobad" })).toEqual({})
  })
})
