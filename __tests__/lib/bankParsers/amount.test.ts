// __tests__/lib/bankParsers/amount.test.ts
import { normaliseSignedAmount } from "@/lib/bankParsers/amount"

describe("normaliseSignedAmount", () => {
  it.each([
    ["-312.40", { amount: "312.40", type: "EXPENSE" }],
    ["200", { amount: "200.00", type: "INCOME" }],
    ["+86.1", { amount: "86.10", type: "INCOME" }],
    ["-1,234.50", { amount: "1234.50", type: "EXPENSE" }],
    [" 0.05 ", { amount: "0.05", type: "INCOME" }],
  ])("normalises %s", (raw, expected) => {
    expect(normaliseSignedAmount(raw)).toEqual(expected)
  })

  it.each(["", "abc", "1.234", "0", "-0.00", "1.2.3", "12,34"])("rejects %s", (raw) => {
    expect(normaliseSignedAmount(raw)).toBeNull()
  })
})
