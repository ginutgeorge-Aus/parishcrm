/** @jest-environment node */
// Verifies the fee line item is added only when the event passes the card fee
// (Task 3), that the surcharge is snapshotted onto the staging row, and that
// the webhook's amount-match guard compares amount_total against
// net + staging.surchargeCents (Task 4 + drift fix) — otherwise a surcharged
// payment would self-refund, and a live recompute could self-refund if the
// fee rate or passCardFee changed in the checkout→webhook window.
jest.mock("@/lib/cardFeeSettings", () => ({ getCardFeeConfig: async () => ({ pct: 1.7, fixedCents: 30 }) }))
// Untyped jest.fn() (no implementation), matching stripeCheckout.create.test.ts's
// convention — an inline async implementation narrows the mock's inferred
// signature to zero params, which then fails `tsc --noEmit` on
// `create.mock.calls[0][0]` (Parameters<> becomes the empty tuple `[]`).
const create = jest.fn()
const refundsCreate = jest.fn()
const constructEvent = jest.fn()
jest.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: { sessions: { create } },
    refunds: { create: refundsCreate },
    webhooks: { constructEvent },
  }),
}))
jest.mock("@/lib/prisma", () => ({ prisma: {
  checkoutSession: {
    create: jest.fn(async () => ({})),
    findUnique: jest.fn(),
    updateMany: jest.fn(async () => ({ count: 1 })),
    update: jest.fn(),
  },
  event: { findUnique: jest.fn() },
} }))
jest.mock("@/lib/crypto", () => ({ encrypt: (s: string) => s, decrypt: (s: string) => s }))
// EVENT_CAPACITY_INCLUDE deliberately lives in its own leaf module (no local
// imports) and is NOT part of this mock — see the comment on that module: it
// stays out of the `@/lib/eventRegistrationPersist` mock so it never needs stubbing.
jest.mock("@/lib/eventRegistrationPersist", () => ({ persistRegistration: jest.fn() }))

import { createEventCheckoutSession, handleStripeWebhook } from "@/lib/stripeCheckout"
const { prisma } = require("@/lib/prisma")
const { persistRegistration } = require("@/lib/eventRegistrationPersist")

// No `as never` here (unlike the brief) — casting the const itself makes its
// type `never`, and spreading a `never`-typed value below (`{ ...baseEvent, ... }`)
// fails `tsc --noEmit` (TS2698). Casting only at the call site achieves the
// same "bypass EventWithTickets's real shape" intent without that side effect.
const baseEvent = {
  id: 1, slug: "gala", title: "Gala",
  ticketTypes: [{ id: 10, name: "Adult" }],
}

const priced = {
  items: [{ ticketTypeId: 10, quantity: 1, unitPrice: 50 }],
  totalAmount: 50,
} as never

beforeEach(() => {
  create.mockClear()
  create.mockResolvedValue({ id: "cs_test_1", url: "https://stripe.test/pay" })
  prisma.checkoutSession.create.mockClear()
  refundsCreate.mockClear()
  persistRegistration.mockClear()
})

it("adds a card fee line item when passCardFee is true", async () => {
  await createEventCheckoutSession({ ...baseEvent, passCardFee: true } as never, priced, "https://app.test")
  const arg = create.mock.calls[0][0]
  const fee = arg.line_items.find((li: { price_data: { product_data: { name: string } } }) =>
    li.price_data.product_data.name === "Card processing fee")
  expect(fee).toBeTruthy()
  expect(fee.price_data.unit_amount).toBe(117) // grossUp(5000,1.7,30).feeCents
  // The same fee is snapshotted onto the staging row for the webhook guard.
  expect(prisma.checkoutSession.create.mock.calls[0][0].data.surchargeCents).toBe(117)
})

it("adds no fee line item when passCardFee is false", async () => {
  await createEventCheckoutSession({ ...baseEvent, passCardFee: false } as never, priced, "https://app.test")
  const arg = create.mock.calls[0][0]
  expect(arg.line_items.some((li: { price_data: { product_data: { name: string } } }) =>
    li.price_data.product_data.name === "Card processing fee")).toBe(false)
  expect(prisma.checkoutSession.create.mock.calls[0][0].data.surchargeCents).toBe(0)
})

it("does not refund a surcharged payment whose amount_total is net + snapshot (Task 4)", async () => {
  // Net total is 50 (5000c); checkout snapshotted surchargeCents=117 (Task 3's
  // fee line), so Stripe charged amount_total=5117. The webhook expects
  // net(5000) + staging.surchargeCents(117) = 5117 → no refund. If the guard
  // compared against the net alone (5000), this would refund a legit payment.
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x"
  constructEvent.mockReturnValue({
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_1", amount_total: 5117, payment_intent: "pi_1", payment_status: "paid" } },
  })
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5,
    status: "OPEN",
    eventId: 1,
    surchargeCents: 117,
    payload: JSON.stringify({ items: [{ ticketTypeId: 10, quantity: 1, unitPrice: 50 }], totalAmount: 50 }),
  })
  prisma.event.findUnique.mockResolvedValue({ id: 1, passCardFee: true, ticketTypes: [] })
  persistRegistration.mockResolvedValue({ ok: true, ref: "REG-X" })

  expect(await handleStripeWebhook("raw", "sig")).toEqual({ status: 200 })
  expect(refundsCreate).not.toHaveBeenCalled()
  expect(persistRegistration).toHaveBeenCalled()
})

it("matches against the checkout snapshot even if the live fee rate changed since (drift fix)", async () => {
  // The webhook must NOT recompute the fee from live config — it compares
  // against the snapshot on the staging row. Prove it: make getCardFeeConfig
  // throw. If the webhook still recomputed, it would blow up; instead it uses
  // net(5000) + surchargeCents(117) = 5117 and processes the payment.
  const cardFeeSettings = require("@/lib/cardFeeSettings") as { getCardFeeConfig: jest.Mock }
  const spy = jest.spyOn(cardFeeSettings, "getCardFeeConfig").mockRejectedValue(new Error("must not be called in webhook"))
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x"
  constructEvent.mockReturnValue({
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_1", amount_total: 5117, payment_intent: "pi_1", payment_status: "paid" } },
  })
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 6,
    status: "OPEN",
    eventId: 1,
    surchargeCents: 117,
    payload: JSON.stringify({ items: [{ ticketTypeId: 10, quantity: 1, unitPrice: 50 }], totalAmount: 50 }),
  })
  prisma.event.findUnique.mockResolvedValue({ id: 1, passCardFee: true, ticketTypes: [] })
  persistRegistration.mockResolvedValue({ ok: true, ref: "REG-Y" })

  expect(await handleStripeWebhook("raw", "sig")).toEqual({ status: 200 })
  expect(refundsCreate).not.toHaveBeenCalled()
  expect(persistRegistration).toHaveBeenCalled()
  spy.mockRestore()
})
