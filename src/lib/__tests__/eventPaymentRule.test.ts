import { paidEventLacksPaymentMethod, hasBankDetails } from "../eventPaymentRule"

const base = {
  ticketPrices: ["25.00"],
  onlinePaymentEnabled: false,
  stripeConfigured: true,
  bankBsb: "",
  bankAccount: "",
}

describe("paidEventLacksPaymentMethod", () => {
  it("flags paid + no card + blank bank", () => {
    expect(paidEventLacksPaymentMethod(base)).toBe(true)
  })
  it("flags when only one bank field is set", () => {
    expect(paidEventLacksPaymentMethod({ ...base, bankBsb: "012-345" })).toBe(true)
    expect(paidEventLacksPaymentMethod({ ...base, bankAccount: "123456" })).toBe(true)
    expect(paidEventLacksPaymentMethod({ ...base, bankBsb: "  ", bankAccount: "1" })).toBe(true)
  })
  it("ok when both bank fields set", () => {
    expect(paidEventLacksPaymentMethod({ ...base, bankBsb: "012-345", bankAccount: "123456" })).toBe(false)
  })
  it("ok for a free event", () => {
    expect(paidEventLacksPaymentMethod({ ...base, ticketPrices: ["0.00", "0"] })).toBe(false)
    expect(paidEventLacksPaymentMethod({ ...base, ticketPrices: [] })).toBe(false)
  })
  it("ok when card is on and Stripe configured", () => {
    expect(paidEventLacksPaymentMethod({ ...base, onlinePaymentEnabled: true })).toBe(false)
  })
  it("flags card on but Stripe not configured", () => {
    expect(paidEventLacksPaymentMethod({ ...base, onlinePaymentEnabled: true, stripeConfigured: false })).toBe(true)
  })
  it("detects paid by any ticket and by tiers only when enabled", () => {
    expect(paidEventLacksPaymentMethod({ ...base, ticketPrices: ["0.00", "10.50"] })).toBe(true)
    const tiers = { ...base, ticketPrices: [], tierPrices: [20, 30] }
    expect(paidEventLacksPaymentMethod(tiers)).toBe(false)
    expect(paidEventLacksPaymentMethod({ ...tiers, tieredPricingEnabled: true })).toBe(true)
  })
  it("accepts Decimal-like prices", () => {
    expect(paidEventLacksPaymentMethod({ ...base, ticketPrices: [{ toString: () => "5.00" }] })).toBe(true)
  })
})

describe("hasBankDetails", () => {
  it("needs both non-blank", () => {
    expect(hasBankDetails("1", "2")).toBe(true)
    expect(hasBankDetails(null, "2")).toBe(false)
    expect(hasBankDetails("1", undefined)).toBe(false)
  })
})
