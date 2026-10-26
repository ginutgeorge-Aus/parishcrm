import { needsCategory, matchesFilter, reviewStats, applyBulkSkip } from "@/lib/bankReviewFilter"
import type { ReviewRow } from "@/lib/bankTypes"

const base: ReviewRow = {
  date: "2026-09-02", description: "X", details: "", amount: "10.00", type: "INCOME",
  bankRef: "R", dedupKey: "K", accountId: null, skip: false, isDuplicate: false,
  familyId: null, personId: null, fromPettyCash: false,
}
const r = (p: Partial<ReviewRow>): ReviewRow => ({ ...base, ...p })

describe("needsCategory", () => {
  it("is true for an active uncategorised row", () => expect(needsCategory(r({}))).toBe(true))
  it("is false once categorised, skipped, or a petty-cash transfer", () => {
    expect(needsCategory(r({ accountId: 1 }))).toBe(false)
    expect(needsCategory(r({ skip: true }))).toBe(false)
    expect(needsCategory(r({ fromPettyCash: true }))).toBe(false)
  })
  it("is true for an ambiguous type even if categorised", () => {
    expect(needsCategory(r({ accountId: 1, ambiguousType: true }))).toBe(true)
  })
  it("is true for an invalid split, false for a valid one", () => {
    expect(needsCategory(r({ splits: [{ accountId: 1, familyId: null, personId: null, amount: "4.00" }] }))).toBe(true)
    expect(needsCategory(r({ splits: [
      { accountId: 1, familyId: null, personId: null, amount: "4.00" },
      { accountId: 2, familyId: null, personId: null, amount: "6.00" },
    ] }))).toBe(false)
  })
})

describe("matchesFilter", () => {
  it("routes rows to tabs", () => {
    expect(matchesFilter(r({}), "all")).toBe(true)
    expect(matchesFilter(r({ personId: 5 }), "matched")).toBe(true)
    expect(matchesFilter(r({ isPossibleDuplicate: true, skip: true }), "duplicates")).toBe(true)
    expect(matchesFilter(r({ isDuplicate: true, skip: true }), "duplicates")).toBe(true)
    expect(matchesFilter(r({ skip: true }), "skipped")).toBe(true)
    expect(matchesFilter(r({ accountId: 1 }), "needsCategory")).toBe(false)
  })
})

describe("reviewStats", () => {
  it("counts tabs and sums active income/expense in cents", () => {
    const s = reviewStats([
      r({ amount: "200.00", personId: 1 }),
      r({ type: "EXPENSE", amount: "312.40", accountId: 2 }),
      r({ amount: "5.00", skip: true, isDuplicate: true }),
    ])
    expect(s).toEqual({ total: 3, needsCategory: 1, matched: 1, duplicates: 1, skipped: 1, incomeCents: 20000, expenseCents: 31240 })
  })
})

describe("applyBulkSkip", () => {
  it("only touches the given indices", () => {
    const rows = [r({ bankRef: "a" }), r({ bankRef: "b" }), r({ bankRef: "c" })]
    expect(applyBulkSkip(rows, true, [0, 2]).map((x) => x.skip)).toEqual([true, false, true])
  })
  it("unskip never un-skips duplicate or possible-duplicate rows", () => {
    const rows = [
      r({ skip: true, isDuplicate: true }),
      r({ skip: true, isPossibleDuplicate: true }),
      r({ skip: true }),
    ]
    expect(applyBulkSkip(rows, false, [0, 1, 2]).map((x) => x.skip)).toEqual([true, true, false])
  })
})
