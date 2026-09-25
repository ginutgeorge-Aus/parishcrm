import { toStripeAmount, roundCentsForCurrency, CurrencyPrecisionError } from "@/lib/stripeAmount"

describe("toStripeAmount", () => {
  it("passes two-decimal currencies through as cents", () => {
    expect(toStripeAmount(12345, "AUD")).toBe(12345)
    expect(toStripeAmount(12345, "USD")).toBe(12345)
  })
  it("divides zero-decimal currencies down to whole units", () => {
    expect(toStripeAmount(100000, "JPY")).toBe(1000)
    expect(toStripeAmount(500000, "KRW")).toBe(5000)
  })
  it("throws on a fractional amount in a zero-decimal currency", () => {
    expect(() => toStripeAmount(100050, "JPY")).toThrow(CurrencyPrecisionError)
  })
  it("passes ISK/UGX through as two-decimal but rejects non-whole amounts", () => {
    expect(toStripeAmount(150000, "ISK")).toBe(150000)
    expect(toStripeAmount(500000, "UGX")).toBe(500000)
    expect(() => toStripeAmount(150050, "ISK")).toThrow(CurrencyPrecisionError)
  })
  it("scales three-decimal currencies by 10 (last digit always 0, as Stripe requires)", () => {
    expect(toStripeAmount(12345, "KWD")).toBe(123450)
  })
})

describe("roundCentsForCurrency", () => {
  it("leaves two-decimal cents unchanged", () => {
    expect(roundCentsForCurrency(137, "AUD")).toBe(137)
  })
  it("rounds to a whole unit for zero-decimal currencies", () => {
    expect(roundCentsForCurrency(1749, "JPY")).toBe(1700)
    expect(roundCentsForCurrency(1750, "JPY")).toBe(1800)
    expect(roundCentsForCurrency(1749, "ISK")).toBe(1700)
  })
})
