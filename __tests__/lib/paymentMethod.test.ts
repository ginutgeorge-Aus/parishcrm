import { CARD_PAYMENT_WHERE, paymentMethodOf } from "@/lib/paymentMethod"

describe("paymentMethodOf", () => {
  it("labels a Stripe PaymentIntent ref as Card", () => {
    expect(paymentMethodOf("pi_123")).toBe("Card")
  })
  it("labels a missing or empty ref as Bank transfer", () => {
    expect(paymentMethodOf(null)).toBe("Bank transfer")
    expect(paymentMethodOf("")).toBe("Bank transfer")
  })
})

describe("CARD_PAYMENT_WHERE", () => {
  it("excludes NULL and empty refs, matching paymentMethodOf", () => {
    // `gt: ""` is false for NULL (SQL) and for "" itself.
    expect(CARD_PAYMENT_WHERE).toEqual({ paymentRef: { gt: "" } })
  })
})
