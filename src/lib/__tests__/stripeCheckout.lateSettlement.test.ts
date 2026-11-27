/** @jest-environment node */
// #813: end-to-end ordering for a delayed-settlement (e.g. BECS) payment whose
// Stripe session lapsed: sweep -> unpaid `completed` -> async_payment_succeeded.
// The row must keep its staged payload throughout so the late paid delivery
// can still build the booking. Uses a small stateful fake of CheckoutSession.
import { handleStripeWebhook } from "@/lib/stripeCheckout"
import { sweepExpiredCheckouts } from "@/lib/checkoutSweep"

jest.mock("@/lib/stripe", () => {
  const webhooks = { constructEvent: jest.fn() }
  const refunds = { create: jest.fn() }
  const checkout = { sessions: { list: jest.fn() } }
  return { getStripe: () => ({ webhooks, refunds, checkout }), STRIPE_API_VERSION: "2026-10-28.endive" }
})
jest.mock("@/lib/eventRegistrationPersist", () => ({ persistRegistration: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: {
  checkoutSession: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn(), count: jest.fn() },
  event: { findUnique: jest.fn() },
  registration: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
} }))
jest.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s.replace("enc:", "") }))
jest.mock("@/lib/notifications", () => ({ notifyStripeAlert: jest.fn() }))
jest.mock("@/lib/stripeWebhookAlert", () => ({ recordWebhookVerificationFailure: jest.fn() }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }))

const { prisma } = require("@/lib/prisma")
const { persistRegistration } = require("@/lib/eventRegistrationPersist")
const { getStripe } = require("@/lib/stripe")
const { notifyStripeAlert } = require("@/lib/notifications")
const constructEvent = getStripe().webhooks.constructEvent

type Row = {
  id: number
  stripeSessionId: string
  eventId: number
  status: string
  registrationId: number | null
  payload: string
  expiresAt: Date
  completedAt: Date | null
  surchargeCents: number
}

/**
 * Minimal in-memory evaluator for the `where` shapes the sweep and webhook use.
 * @param row the staged row
 * @param where Prisma-style filter
 * @returns whether the row matches
 */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Record<string, unknown>[]).some((w) => matches(row, w))
    const actual = (row as unknown as Record<string, unknown>)[k]
    if (v !== null && typeof v === "object") {
      const f = v as { not?: unknown; lt?: Date }
      if ("not" in f) return actual !== f.not
      if (f.lt) return (actual as Date).getTime() < f.lt.getTime()
    }
    return actual === v
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x"
})

it("keeps the payload through the sweep and an unpaid completed, then builds the booking on settlement", async () => {
  const row: Row = {
    id: 5, stripeSessionId: "cs_becs", eventId: 7, status: "OPEN", registrationId: null, surchargeCents: 0, completedAt: null,
    expiresAt: new Date(Date.now() - 60_000),
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  }
  prisma.checkoutSession.updateMany.mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
    if (!matches(row, where)) return { count: 0 }
    Object.assign(row, data)
    return { count: 1 }
  })
  prisma.checkoutSession.findUnique.mockImplementation(async () => ({ ...row }))
  prisma.event.findUnique.mockResolvedValue({ id: 7, ticketTypes: [] })
  persistRegistration.mockResolvedValue({ ok: true, ref: "REG-BECS" })

  // 1. Sweep: lapsed OPEN row becomes EXPIRED but keeps its payload.
  expect(await sweepExpiredCheckouts()).toEqual({ expired: 1, scrubbed: 0 })
  expect(row.status).toBe("EXPIRED")
  expect(row.payload).not.toBe("")

  // 2. Late unpaid `completed`: stays EXPIRED, expiry pushed out, payload kept.
  constructEvent.mockReturnValue({ type: "checkout.session.completed",
    data: { object: { id: "cs_becs", payment_intent: "pi_b", amount_total: 2000, payment_status: "unpaid" } } })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(row.status).toBe("EXPIRED")
  expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000)
  expect(persistRegistration).not.toHaveBeenCalled()

  // 3. A sweep right after must not scrub the pushed-out row.
  expect(await sweepExpiredCheckouts()).toEqual({ expired: 0, scrubbed: 0 })
  expect(row.payload).not.toBe("")

  // 4. Settlement: async_payment_succeeded claims the EXPIRED row.
  constructEvent.mockReturnValue({ type: "checkout.session.async_payment_succeeded",
    data: { object: { id: "cs_becs", payment_intent: "pi_b", amount_total: 2000, payment_status: "paid" } } })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(row.status).toBe("COMPLETED")
  expect(persistRegistration).toHaveBeenCalledWith(expect.anything(), expect.anything(),
    { paymentStatus: "PAID", paymentRef: "pi_b" })
  expect(notifyStripeAlert).not.toHaveBeenCalled()
})
