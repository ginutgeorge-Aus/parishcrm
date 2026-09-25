/** @jest-environment node */
// Task 4: createEventCheckoutSession must price line items in AUD cents from
// the server-recomputed `priced` result (never trust client-sent prices) and
// stage an ENCRYPTED payload in CheckoutSession — no plaintext PII at rest.

const create = jest.fn()
jest.mock("@/lib/stripe", () => ({
  stripeConfigured: () => true,
  getStripe: () => ({ checkout: { sessions: { create } } }),
}))
jest.mock("@/lib/prisma", () => ({ prisma: { checkoutSession: { create: jest.fn() } } }))
// Real @/lib/crypto.encrypt runs (AES-256-GCM, keyed by jest.setup.ts's
// ENCRYPTION_KEY) — the assertion below needs genuine ciphertext, not a
// mock that merely prefixes the plaintext.

import { createEventCheckoutSession } from "@/lib/stripeCheckout"
import type { EventWithTickets, PricedRegistration } from "@/lib/eventRegistrationPricing"

function makeEventWithTickets(overrides: Record<string, unknown> = {}): EventWithTickets {
  return {
    id: 1,
    slug: "fete",
    title: "Spring Fete",
    isPublished: true,
    date: null,
    endDate: null,
    description: null,
    location: null,
    bankBsb: "062-000",
    bankAccount: "12345678",
    customQuestions: [],
    ticketTypes: [
      { id: 1, name: "Adult", price: 10, capacity: null, registrationItems: [] },
    ],
    ...overrides,
  } as unknown as EventWithTickets
}

beforeEach(() => {
  jest.clearAllMocks()
})

it("creates a stripe session with AUD cents line items and stages an encrypted payload", async () => {
  create.mockResolvedValue({ id: "cs_test_1", url: "https://stripe/pay/cs_test_1" })
  const event = makeEventWithTickets({
    id: 7,
    slug: "camp",
    title: "Camp",
    ticketTypes: [{ id: 1, name: "Adult", price: "10.00", capacity: null, registrationItems: [] }],
  })
  const priced: PricedRegistration = {
    firstName: "A",
    lastName: "B",
    email: "a@b.com",
    emailHash: "h",
    items: [{ ticketTypeId: 1, quantity: 2, unitPrice: 10, attendeeNames: ["X", "Y"], perAttendeeAnswers: [] }],
    totalAmount: 20,
    waivedCount: 0,
    capacityChecks: [],
  }
  const res = await createEventCheckoutSession(event, priced, "https://app.test")

  expect(res.url).toBe("https://stripe/pay/cs_test_1")
  const arg = create.mock.calls[0][0]
  expect(arg.mode).toBe("payment")
  expect(arg.line_items[0].price_data.currency).toBe("aud")
  expect(arg.line_items[0].price_data.unit_amount).toBe(1000) // $10 -> 1000 cents
  expect(arg.line_items[0].quantity).toBe(2)

  const { prisma } = require("@/lib/prisma")
  expect(prisma.checkoutSession.create).toHaveBeenCalled()
  // payload persisted must not contain plaintext email
  expect(JSON.stringify(prisma.checkoutSession.create.mock.calls[0][0])).not.toContain("a@b.com")
})

it("collapses to a single net-total line item when a discount makes the per-ticket sum diverge (tiered/waiver)", async () => {
  // Tiered pricing / family waiver set totalAmount BELOW the per-ticket sum
  // while items keep the true unitPrice snapshot. Per-ticket line items would
  // sum to 30 (3×$10) and overcharge — and then fail the webhook amount-match
  // (expectedCents uses totalAmount=25). Must collapse to one line at 2500c.
  create.mockResolvedValue({ id: "cs_test_3", url: "https://stripe/pay/cs_test_3" })
  const event = makeEventWithTickets({
    id: 9, slug: "family", title: "Family Day",
    ticketTypes: [{ id: 1, name: "Adult", price: "10.00", capacity: null, registrationItems: [] }],
  })
  const priced: PricedRegistration = {
    firstName: "A", lastName: "B", email: "a@b.com", emailHash: "h",
    items: [{ ticketTypeId: 1, quantity: 3, unitPrice: 10, attendeeNames: ["X", "Y", "Z"], perAttendeeAnswers: [] }],
    totalAmount: 25, // discounted below 3×$10
    waivedCount: 0, capacityChecks: [],
  }
  await createEventCheckoutSession(event, priced, "https://app.test")
  const arg = create.mock.calls[0][0]
  expect(arg.line_items).toHaveLength(1)
  expect(arg.line_items[0].quantity).toBe(1)
  expect(arg.line_items[0].price_data.unit_amount).toBe(2500) // net total, not 3000
  const sum = arg.line_items.reduce(
    (s: number, li: { quantity: number; price_data: { unit_amount: number } }) =>
      s + li.quantity * li.price_data.unit_amount, 0)
  expect(sum).toBe(2500) // matches webhook expectedCents = toCents(totalAmount)
})

it("sets expires_at strictly above Stripe's 30-min floor (latency buffer)", async () => {
  // Stripe rejects a CheckoutSession whose expires_at is under 30 minutes out.
  // Sending exactly 30 min means network + processing latency lands the value
  // under the floor by the time Stripe evaluates it → InvalidRequestError. The
  // expiry must carry a buffer, so it must be STRICTLY more than 30 min ahead.
  create.mockResolvedValue({ id: "cs_test_4", url: "https://stripe/pay/cs_test_4" })
  const event = makeEventWithTickets({ id: 7, slug: "camp" })
  const priced: PricedRegistration = {
    firstName: "A", lastName: "B", email: "a@b.com", emailHash: "h",
    items: [{ ticketTypeId: 1, quantity: 1, unitPrice: 10, attendeeNames: ["X"], perAttendeeAnswers: [] }],
    totalAmount: 10, waivedCount: 0, capacityChecks: [],
  }
  const before = Date.now()
  await createEventCheckoutSession(event, priced, "https://app.test")
  const arg = create.mock.calls[0][0]
  const secondsAhead = arg.expires_at - Math.floor(before / 1000)
  // > 1800s (30 min), i.e. a real buffer above the floor — not exactly at it.
  expect(secondsAhead).toBeGreaterThan(30 * 60)
})

it("tags the session and PaymentIntent with eventId/eventSlug metadata", async () => {
  create.mockResolvedValue({ id: "cs_test_2", url: "https://stripe/pay/cs_test_2" })
  const event = makeEventWithTickets({ id: 7, slug: "camp" })
  const priced: PricedRegistration = {
    firstName: "A", lastName: "B", email: "a@b.com", emailHash: "h",
    items: [{ ticketTypeId: 1, quantity: 1, unitPrice: 10, attendeeNames: ["X"], perAttendeeAnswers: [] }],
    totalAmount: 10, waivedCount: 0, capacityChecks: [],
  }
  await createEventCheckoutSession(event, priced, "https://app.test")
  const arg = create.mock.calls[0][0]
  expect(arg.metadata).toEqual({ eventSlug: "camp", eventId: "7" })
  expect(arg.payment_intent_data.metadata).toEqual({ eventSlug: "camp", eventId: "7" })
})
