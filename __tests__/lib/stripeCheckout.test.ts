/** @jest-environment node */

// Stripe glue — no next/server import (see docs/reference-jest-nextserver-route-trap.md).
const mockCreate = jest.fn().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" })
jest.mock("@/lib/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { create: mockCreate } } }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: { checkoutSession: { create: jest.fn().mockResolvedValue({}) } },
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/cardFeeSettings", () => ({ getCardFeeConfig: jest.fn() }))

import { createEventCheckoutSession } from "@/lib/stripeCheckout"
import type { PricedRegistration, EventWithTickets } from "@/lib/eventRegistrationPricing"

const baseEvent = {
  id: 1,
  slug: "harvest",
  title: "Harvest Dinner",
  passCardFee: false,
  ticketTypes: [
    { id: 10, name: "Adult" },
    { id: 11, name: "Child (free)" },
  ],
} as unknown as EventWithTickets

const pricedItem = (ticketTypeId: number, unitPrice: number, quantity = 1) => ({
  ticketTypeId,
  quantity,
  unitPrice,
  attendeeNames: [],
  perAttendeeAnswers: [],
})

beforeEach(() => jest.clearAllMocks())

describe("createEventCheckoutSession — line item building", () => {
  it("drops zero-priced ticket line items so Stripe never sees a unit_amount of 0", async () => {
    // A paid Adult + a free Child. No discount, so rawCents === netCents and the
    // per-item branch runs. The free item must not reach Stripe as unit_amount 0.
    const priced = {
      firstName: "A",
      lastName: "B",
      email: "a@b.com",
      emailHash: "h",
      items: [pricedItem(10, 45), pricedItem(11, 0)],
      totalAmount: 45,
      waivedCount: 0,
      capacityChecks: [],
    } as unknown as PricedRegistration

    await createEventCheckoutSession(baseEvent, priced, "https://app.example.com")

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const arg = mockCreate.mock.calls[0][0]
    const amounts = arg.line_items.map((li: { price_data: { unit_amount: number } }) => li.price_data.unit_amount)
    expect(amounts).not.toContain(0)
    expect(amounts).toEqual([4500])
  })

  it("keeps a single paid line item unchanged", async () => {
    const priced = {
      firstName: "A", lastName: "B", email: "a@b.com", emailHash: "h",
      items: [pricedItem(10, 45)],
      totalAmount: 45, waivedCount: 0, capacityChecks: [],
    } as unknown as PricedRegistration

    await createEventCheckoutSession(baseEvent, priced, "https://app.example.com")
    const arg = mockCreate.mock.calls[0][0]
    expect(arg.line_items).toHaveLength(1)
    expect(arg.line_items[0].price_data.unit_amount).toBe(4500)
  })
})
