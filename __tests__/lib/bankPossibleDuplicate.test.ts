// __tests__/lib/bankPossibleDuplicate.test.ts
import { findPossibleDuplicates } from "@/lib/bankPossibleDuplicate"

const row = (bankRef: string, date: string, amount: string, type: "INCOME" | "EXPENSE" = "INCOME") => ({ bankRef, date, amount, type })
const tx = (date: string, amount: string, type = "INCOME") => ({ date: new Date(`${date}T00:00:00.000Z`), amount: { toString: () => amount }, type })

describe("findPossibleDuplicates", () => {
  it("flags same date + amount + type", () => {
    expect(findPossibleDuplicates([row("A", "2026-09-02", "200.00")], new Set(), [tx("2026-09-02", "200")])).toEqual(["A"])
  })
  it("ignores different date, amount or direction", () => {
    const rows = [row("A", "2026-09-03", "200.00"), row("B", "2026-09-02", "200.01"), row("C", "2026-09-02", "200.00", "EXPENSE")]
    expect(findPossibleDuplicates(rows, new Set(), [tx("2026-09-02", "200.00")])).toEqual([])
  })
  it("skips rows already exact duplicates", () => {
    expect(findPossibleDuplicates([row("A", "2026-09-02", "1.00")], new Set(["A"]), [tx("2026-09-02", "1.00")])).toEqual([])
  })
  it("consumes each existing transaction once", () => {
    const rows = [row("A", "2026-09-02", "5.00"), row("B", "2026-09-02", "5.00")]
    expect(findPossibleDuplicates(rows, new Set(), [tx("2026-09-02", "5.00")])).toEqual(["A"])
  })
})
