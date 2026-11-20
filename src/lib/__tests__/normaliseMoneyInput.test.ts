import { normaliseMoneyInput, SIGNED_MONEY_DECIMAL_RE } from "@/lib/validation"

describe("normaliseMoneyInput", () => {
  it.each([
    ["1,000.00", "1000.00"],
    [" 1 000.5 ", "1000.5"],
    ["$12", "12"],
    ["-$5.00", "-5.00"],
    ["-5.00", "-5.00"],
    ["abc", "abc"],
    ["1,234,567.89", "1234567.89"],
    ["1,00", "1,00"],
    ["1,5", "1,5"],
    ["1,0,0.00", "1,0,0.00"],
  ])("%j -> %j", (raw, out) => {
    expect(normaliseMoneyInput(raw)).toBe(out)
  })
  it("result of valid input matches the money pattern; junk does not", () => {
    expect(SIGNED_MONEY_DECIMAL_RE.test(normaliseMoneyInput("1,000.00"))).toBe(true)
    expect(SIGNED_MONEY_DECIMAL_RE.test(normaliseMoneyInput("abc"))).toBe(false)
    for (const bad of ["1,00", "1,5", "1,0,0.00"]) {
      expect(SIGNED_MONEY_DECIMAL_RE.test(normaliseMoneyInput(bad))).toBe(false)
    }
  })
})
