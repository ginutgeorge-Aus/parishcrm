/** @jest-environment node */
// Task 5: handleStripeWebhook — signature verification, idempotency, and
// refund-on-oversell for the Stripe event-payments flow. Security-critical:
// a forged/replayed webhook must never create a registration or leak the
// raw body into logs.
import { handleStripeWebhook } from "@/lib/stripeCheckout"

// NOTE on the mock shape below: jest.mock() factories are hoisted above every
// other top-level statement in this file (including `const x = jest.fn()`
// lines written textually above them), so a factory that reads an
// outer-scope variable directly — e.g. `() => ({ persistRegistration })` where
// `persistRegistration` is a `const` declared elsewhere in this file — throws
// a TDZ ReferenceError: the factory runs (at the transpiled `require()` call
// for the `import` above) before that `const` has initialized. Each factory
// here instead creates its own jest.fn()s as LOCAL variables (no outer-scope
// read), and the shared reference tests need is obtained by `require()`-ing
// the now-mocked module back out afterwards — same pattern already used below
// for `prisma`.
jest.mock("@/lib/stripe", () => {
  const webhooks = { constructEvent: jest.fn() }
  const refunds = { create: jest.fn() }
  const checkout = { sessions: { list: jest.fn() } }
  return { getStripe: () => ({ webhooks, refunds, checkout }) }
})
jest.mock("@/lib/eventRegistrationPersist", () => ({ persistRegistration: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: {
  checkoutSession: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  event: { findUnique: jest.fn() },
  registration: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
} }))
jest.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s.replace("enc:", "") }))
jest.mock("@/lib/notifications", () => ({ notifyStripeAlert: jest.fn() }))

const { prisma } = require("@/lib/prisma")
const { persistRegistration } = require("@/lib/eventRegistrationPersist")
const { getStripe } = require("@/lib/stripe")
const { notifyStripeAlert } = require("@/lib/notifications")
const constructEvent = getStripe().webhooks.constructEvent
const refundsCreate = getStripe().refunds.create
const sessionsList = getStripe().checkout.sessions.list

beforeEach(() => {
  jest.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x"
  // Default: this delivery wins the atomic OPEN→COMPLETED claim.
  prisma.checkoutSession.updateMany.mockResolvedValue({ count: 1 })
  // Default: a reversal's PaymentIntent maps to no Checkout Session.
  sessionsList.mockResolvedValue({ data: [] })
})

// amountTotal defaults to 2000 cents = the toCents() of the staged totalAmount:20
// used in every payload below, so the server-side amount assertion passes.
function completedEvent(sessionId = "cs_1", pi = "pi_1", amountTotal = 2000) {
  return { type: "checkout.session.completed", data: { object: { id: sessionId, payment_intent: pi, amount_total: amountTotal, payment_status: "paid" } } }
}

it("rejects a bad signature with 400", async () => {
  constructEvent.mockImplementation(() => { throw new Error("bad sig") })
  expect(await handleStripeWebhook("{}", "t=1,v1=bad")).toEqual({ status: 400 })
  expect(persistRegistration).not.toHaveBeenCalled()
})

it("rejects with 400 + loud console.error when STRIPE_WEBHOOK_SECRET is unset", async () => {
  delete process.env.STRIPE_WEBHOOK_SECRET
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 400 })
  expect(persistRegistration).not.toHaveBeenCalled()
  expect(constructEvent).not.toHaveBeenCalled()
  // Own-side misconfig must be observable, not silent like routine bad traffic.
  expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("STRIPE_WEBHOOK_SECRET"))
  errSpy.mockRestore()
})

it("rejects with 400 when signature header is missing — silent, routine bad traffic", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  expect(await handleStripeWebhook("{}", null)).toEqual({ status: 400 })
  expect(persistRegistration).not.toHaveBeenCalled()
  expect(constructEvent).not.toHaveBeenCalled()
  expect(errSpy).not.toHaveBeenCalled()
  errSpy.mockRestore()
})

it("creates a PAID registration on checkout.session.completed", async () => {
  constructEvent.mockReturnValue(completedEvent())
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5, eventId: 7, status: "OPEN", surchargeCents: 0,
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  })
  prisma.event.findUnique.mockResolvedValue({ id: 7, ticketTypes: [] })
  persistRegistration.mockResolvedValue({ ok: true, ref: "REG-XYZ" })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(persistRegistration).toHaveBeenCalledWith(expect.anything(), expect.anything(),
    { paymentStatus: "PAID", paymentRef: "pi_1" })
  // Row claimed atomically OPEN→COMPLETED, then publicToken stored on success.
  expect(prisma.checkoutSession.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 5, status: "OPEN" },
      data: expect.objectContaining({ status: "COMPLETED" }),
    }))
  expect(prisma.checkoutSession.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 5 }, data: { publicToken: "REG-XYZ" } }))
})

it("does NOT refund a GENUINE duplicate second charge (different PI) — keeps money, signals ops, resolves to original (no-refund policy)", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  constructEvent.mockReturnValue(completedEvent("cs_2", "pi_dup"))
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5, eventId: 7, status: "OPEN", surchargeCents: 0,
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  })
  prisma.event.findUnique.mockResolvedValue({ id: 7, ticketTypes: [] })
  persistRegistration.mockResolvedValue({ ok: true, ref: "REG-ORIG", duplicate: true })
  // The existing registration was created by a DIFFERENT PaymentIntent —
  // this is a genuine second charge, not the same session redelivered.
  prisma.registration.findUnique.mockResolvedValue({ paymentRef: "pi_original" })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(refundsCreate).not.toHaveBeenCalled()
  expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("duplicate"))
  expect(notifyStripeAlert).toHaveBeenCalledWith(expect.stringContaining("duplicate charge"), expect.any(String))
  errSpy.mockRestore()
})

it("does NOT write the victim's publicToken onto this payer's CheckoutSession on a genuine duplicate (PII/QR leak)", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  constructEvent.mockReturnValue(completedEvent("cs_2", "pi_dup"))
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5, eventId: 7, status: "OPEN", surchargeCents: 0,
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  })
  prisma.event.findUnique.mockResolvedValue({ id: 7, ticketTypes: [] })
  persistRegistration.mockResolvedValue({ ok: true, ref: "REG-ORIG", duplicate: true })
  // Different PaymentIntent → a real second payer, not a redelivery.
  prisma.registration.findUnique.mockResolvedValue({ paymentRef: "pi_original" })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  // The stranger's CheckoutSession must never resolve to the victim's ref via
  // the success page — no publicToken write on a genuine duplicate.
  expect(prisma.checkoutSession.update).not.toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ publicToken: expect.anything() }) }))
  // Instead the row is terminalized UNFULFILLED so the success page shows the
  // contact-us state, not "being finalised" forever.
  expect(prisma.checkoutSession.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 5 }, data: { status: "UNFULFILLED" } }))
  errSpy.mockRestore()
})

it("backfills a null publicToken on a COMPLETED redelivery — recovers a crash between persist and the token write", async () => {
  // A prior pass claimed COMPLETED and persisted the registration but died
  // before stamping publicToken (that write is outside persist's transaction).
  // Stripe redelivers; the row is COMPLETED with no token.
  constructEvent.mockReturnValue(completedEvent("cs_1", "pi_1"))
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5, eventId: 7, status: "COMPLETED", publicToken: null, surchargeCents: 0,
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  })
  // The registration created on the crashed pass carries this PaymentIntent.
  prisma.registration.findFirst.mockResolvedValue({ publicToken: "REG-CRASH" })

  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })

  // Recovered without re-running the claim/persist (money already taken once).
  expect(prisma.checkoutSession.updateMany).not.toHaveBeenCalled()
  expect(persistRegistration).not.toHaveBeenCalled()
  expect(prisma.registration.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ paymentRef: "pi_1", eventId: 7 }) }))
  expect(prisma.checkoutSession.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 5 }, data: { publicToken: "REG-CRASH" } }))
})

it("alerts ops when a COMPLETED row has no publicToken AND no registration matches its PaymentIntent", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  constructEvent.mockReturnValue(completedEvent("cs_1", "pi_1"))
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5, eventId: 7, status: "COMPLETED", publicToken: null, surchargeCents: 0,
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  })
  prisma.registration.findFirst.mockResolvedValue(null)

  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })

  expect(prisma.checkoutSession.update).not.toHaveBeenCalled()
  expect(notifyStripeAlert).toHaveBeenCalled()
  errSpy.mockRestore()
})

it("does NOT alert on a SAME-session redelivery after the publicToken update previously threw — quiet, expected, only one charge ever happened", async () => {
  // Mirrors the row's own earlier redelivery: same session id, same PI, and
  // persistRegistration's dedupe finds its own already-created registration.
  constructEvent.mockReturnValue(completedEvent("cs_1", "pi_1"))
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5, eventId: 7, status: "OPEN", surchargeCents: 0,
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  })
  prisma.event.findUnique.mockResolvedValue({ id: 7, ticketTypes: [] })
  persistRegistration.mockResolvedValue({ ok: true, ref: "REG-ORIG", duplicate: true })
  // The existing registration was created by THIS SAME PaymentIntent.
  prisma.registration.findUnique.mockResolvedValue({ paymentRef: "pi_1" })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(notifyStripeAlert).not.toHaveBeenCalled()
  expect(prisma.checkoutSession.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 5 }, data: { publicToken: "REG-ORIG" } }))
})

it("is idempotent — skips an already COMPLETED staging row", async () => {
  constructEvent.mockReturnValue(completedEvent())
  prisma.checkoutSession.findUnique.mockResolvedValue({ id: 5, status: "COMPLETED" })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(persistRegistration).not.toHaveBeenCalled()
  expect(prisma.checkoutSession.updateMany).not.toHaveBeenCalled()
})

it("no-ops a concurrent redelivery that loses the atomic claim (TOCTOU)", async () => {
  // Both deliveries pass findUnique (status OPEN), but this one's claim matches
  // 0 rows — the other delivery already flipped it. Must not persist or refund.
  constructEvent.mockReturnValue(completedEvent("cs_1", "pi_9"))
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5, eventId: 7, status: "OPEN", surchargeCents: 0,
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  })
  prisma.checkoutSession.updateMany.mockResolvedValue({ count: 0 })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(persistRegistration).not.toHaveBeenCalled()
  expect(refundsCreate).not.toHaveBeenCalled()
  expect(prisma.checkoutSession.update).not.toHaveBeenCalled()
})

it("does NOT refund when capacity is gone — keeps money, signals ops, no registration (no-refund policy)", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  constructEvent.mockReturnValue(completedEvent("cs_1", "pi_9"))
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5, eventId: 7, status: "OPEN", surchargeCents: 0,
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  })
  prisma.event.findUnique.mockResolvedValue({ id: 7, ticketTypes: [] })
  persistRegistration.mockResolvedValue({ ok: false, status: 400, error: "Adult tickets sold out" })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(refundsCreate).not.toHaveBeenCalled()
  expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("could not be created"))
  expect(notifyStripeAlert).toHaveBeenCalledWith(expect.stringContaining("registration not created"), expect.any(String))
  // Row was claimed COMPLETED atomically; no publicToken since no registration.
  expect(prisma.checkoutSession.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }))
  // ...then marked terminal UNFULFILLED so the success page tells the customer
  // instead of "being finalised" forever. No publicToken written.
  expect(prisma.checkoutSession.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 5 }, data: { status: "UNFULFILLED" } }))
  errSpy.mockRestore()
})

it("keeps money + completes staging row when the event no longer exists — signals ops, no refund (no-refund policy)", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  constructEvent.mockReturnValue(completedEvent("cs_1", "pi_9"))
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5, eventId: 7, status: "OPEN", surchargeCents: 0,
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  })
  prisma.event.findUnique.mockResolvedValue(null)
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(persistRegistration).not.toHaveBeenCalled()
  expect(refundsCreate).not.toHaveBeenCalled()
  expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("could not be created"))
  // Claimed COMPLETED (money not stuck OPEN); no publicToken since no registration.
  expect(prisma.checkoutSession.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 5, status: "OPEN" }, data: expect.objectContaining({ status: "COMPLETED" }) }))
  // Then marked terminal UNFULFILLED for the success-page message.
  expect(prisma.checkoutSession.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 5 }, data: { status: "UNFULFILLED" } }))
  errSpy.mockRestore()
})

it("unclaims back to OPEN and returns 500 when persisting throws unexpectedly — so Stripe retries instead of the row being stuck COMPLETED forever", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  constructEvent.mockReturnValue(completedEvent("cs_1", "pi_9"))
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5, eventId: 7, status: "OPEN", surchargeCents: 0,
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  })
  prisma.event.findUnique.mockResolvedValue({ id: 7, ticketTypes: [] })
  persistRegistration.mockRejectedValue(new Error("transient DB error"))
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 500 })
  // First call is the atomic OPEN→COMPLETED claim; the row must be unclaimed
  // back to OPEN afterwards so a Stripe redelivery can retry the persist.
  // expiresAt is also reset — otherwise an unclaim near the end of the
  // 31-min window leaves too little runway for Stripe's retry before the
  // hourly sweep expires the row out from under it.
  expect(prisma.checkoutSession.updateMany).toHaveBeenNthCalledWith(2,
    { where: { id: 5, status: "COMPLETED" }, data: { status: "OPEN", completedAt: null, expiresAt: expect.any(Date) } })
  const unclaimArg = prisma.checkoutSession.updateMany.mock.calls[1][0]
  expect(unclaimArg.data.expiresAt.getTime()).toBeGreaterThan(Date.now())
  expect(prisma.checkoutSession.update).not.toHaveBeenCalled()
  expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("unexpected error"), expect.any(Error))
  // Also emails ops: every other charged-but-undelivered branch alerts;
  // this one must too, or a persistent cause (corrupt payload/repeatable DB
  // error) stays silent for the whole ~3-day Stripe retry window.
  expect(notifyStripeAlert).toHaveBeenCalledWith(
    expect.stringContaining("persist"), expect.any(String))
  errSpy.mockRestore()
})

it("alerts when a PAID webhook has NO staging row at all — event/session cascade-deleted mid-checkout, money charged with zero CRM record", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  constructEvent.mockReturnValue(completedEvent("cs_gone", "pi_gone"))
  prisma.checkoutSession.findUnique.mockResolvedValue(null)
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(persistRegistration).not.toHaveBeenCalled()
  expect(prisma.checkoutSession.updateMany).not.toHaveBeenCalled() // nothing to claim
  expect(notifyStripeAlert).toHaveBeenCalledWith(
    expect.stringContaining("charged"), expect.any(String))
  errSpy.mockRestore()
})

it("alerts when a PAID webhook matches an already-EXPIRED staging row — sweep beat settlement/retry, money charged with no registration", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  constructEvent.mockReturnValue(completedEvent("cs_1", "pi_9"))
  prisma.checkoutSession.findUnique.mockResolvedValue({ id: 5, eventId: 7, status: "EXPIRED" })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(persistRegistration).not.toHaveBeenCalled()
  expect(prisma.checkoutSession.updateMany).not.toHaveBeenCalled() // no claim attempt on a non-OPEN row
  expect(notifyStripeAlert).toHaveBeenCalledWith(
    expect.stringContaining("charged"), expect.any(String))
  errSpy.mockRestore()
})

it("stays quiet (no alert) when a redelivery matches an already-COMPLETED or UNFULFILLED row — that outcome already signalled ops on its own first pass", async () => {
  constructEvent.mockReturnValue(completedEvent("cs_1", "pi_9"))
  // A successful first pass stamps publicToken, so a benign redelivery of a
  // COMPLETED row carries one — it must stay quiet (not the token-less crash
  // path, which recovers/alerts separately).
  prisma.checkoutSession.findUnique.mockResolvedValue({ id: 5, eventId: 7, status: "COMPLETED", publicToken: "REG-DONE" })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(notifyStripeAlert).not.toHaveBeenCalled()
})

it("keeps money + never registers when charged amount ≠ server-priced total — signals ops, no refund (no-refund policy)", async () => {
  // Defense-in-depth: the staged total is 20 (→2000c) but Stripe reports a
  // 1000c charge. Must create no registration and keep the money, not honour it.
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  constructEvent.mockReturnValue(completedEvent("cs_1", "pi_9", 1000))
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5, eventId: 7, status: "OPEN", surchargeCents: 0,
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(persistRegistration).not.toHaveBeenCalled()
  expect(refundsCreate).not.toHaveBeenCalled()
  expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("amount mismatch"))
  expect(notifyStripeAlert).toHaveBeenCalledWith(expect.stringContaining("amount mismatch"), expect.any(String))
  // Row was claimed COMPLETED so Stripe won't redeliver; no publicToken. Marked
  // terminal UNFULFILLED so the success page tells the customer.
  expect(prisma.checkoutSession.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 5 }, data: { status: "UNFULFILLED" } }))
  errSpy.mockRestore()
})

it("does NOT create a registration when payment_status is not 'paid' (async method not settled), but extends expiresAt to protect the row from the sweep", async () => {
  constructEvent.mockReturnValue({ type: "checkout.session.completed",
    data: { object: { id: "cs_async", payment_intent: "pi_a", amount_total: 2000, payment_status: "unpaid" } } })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(persistRegistration).not.toHaveBeenCalled()
  expect(prisma.checkoutSession.findUnique).not.toHaveBeenCalled()
  // A delayed/async method (e.g. BECS) can settle days later — extend the
  // staging row's expiry well past the hourly sweep so the eventual
  // async_payment_succeeded webhook doesn't hit an already-EXPIRED row.
  expect(prisma.checkoutSession.updateMany).toHaveBeenCalledWith({
    where: { stripeSessionId: "cs_async", status: "OPEN" },
    data: { expiresAt: expect.any(Date) },
  })
  const arg = prisma.checkoutSession.updateMany.mock.calls[0][0]
  expect(arg.data.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000)
})

it("persists on checkout.session.async_payment_succeeded", async () => {
  constructEvent.mockReturnValue({ type: "checkout.session.async_payment_succeeded",
    data: { object: { id: "cs_1", payment_intent: "pi_1", amount_total: 2000, payment_status: "paid" } } })
  prisma.checkoutSession.findUnique.mockResolvedValue({
    id: 5, eventId: 7, status: "OPEN", surchargeCents: 0,
    payload: "enc:" + JSON.stringify({ firstName: "A", totalAmount: 20, items: [], capacityChecks: [] }),
  })
  prisma.event.findUnique.mockResolvedValue({ id: 7, ticketTypes: [] })
  persistRegistration.mockResolvedValue({ ok: true, ref: "REG-ASYNC" })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(persistRegistration).toHaveBeenCalledWith(expect.anything(), expect.anything(),
    { paymentStatus: "PAID", paymentRef: "pi_1" })
  expect(prisma.checkoutSession.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 5 }, data: { publicToken: "REG-ASYNC" } }))
})

it("expires the staging row + clears payload on async_payment_failed, no registration", async () => {
  constructEvent.mockReturnValue({ type: "checkout.session.async_payment_failed",
    data: { object: { id: "cs_fail" } } })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(persistRegistration).not.toHaveBeenCalled()
  expect(prisma.checkoutSession.updateMany).toHaveBeenCalledWith({
    where: { stripeSessionId: "cs_fail", status: "OPEN" },
    data: { status: "EXPIRED", payload: "" },
  })
})

it("cancels the registration on a FULL charge.refunded", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  constructEvent.mockReturnValue({ type: "charge.refunded",
    data: { object: { id: "ch_1", payment_intent: "pi_1", amount: 2000, amount_refunded: 2000 } } })
  prisma.registration.findFirst.mockResolvedValue({ id: 11, eventId: 7, paymentStatus: "PAID" })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(prisma.registration.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { paymentRef: "pi_1" } }))
  expect(prisma.registration.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 11 }, data: { paymentStatus: "CANCELLED" } }))
  errSpy.mockRestore()
})

it("does NOT cancel on a PARTIAL charge.refunded", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  constructEvent.mockReturnValue({ type: "charge.refunded",
    data: { object: { id: "ch_2", payment_intent: "pi_2", amount: 2000, amount_refunded: 500 } } })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(prisma.registration.findFirst).not.toHaveBeenCalled()
  expect(prisma.registration.update).not.toHaveBeenCalled()
  expect(notifyStripeAlert).toHaveBeenCalledWith(expect.stringContaining("partial refund"), expect.any(String))
  errSpy.mockRestore()
})

it("cancels the registration on charge.dispute.created", async () => {
  constructEvent.mockReturnValue({ type: "charge.dispute.created",
    data: { object: { id: "dp_1", payment_intent: "pi_3" } } })
  prisma.registration.findFirst.mockResolvedValue({ id: 12, eventId: 7, paymentStatus: "PAID" })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(prisma.registration.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 12 }, data: { paymentStatus: "CANCELLED" } }))
})

it("no-ops a charge.refunded for an unknown PaymentIntent", async () => {
  constructEvent.mockReturnValue({ type: "charge.refunded",
    data: { object: { id: "ch_3", payment_intent: "pi_unknown", amount: 2000, amount_refunded: 2000 } } })
  prisma.registration.findFirst.mockResolvedValue(null)
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(prisma.registration.update).not.toHaveBeenCalled()
})

// /: Stripe doesn't order deliveries. A reversal that lands before
// checkout.session.completed has been processed finds no registration by
// paymentRef yet — acknowledging it would let the later completion activate a
// refunded/disputed booking. Defer (500) while the checkout is still in flight
// so Stripe redelivers the reversal after completion.
describe("reversal delivered before its checkout completion", () => {
  function refundEvent(pi = "pi_early") {
    return { type: "charge.refunded",
      data: { object: { id: "ch_e", payment_intent: pi, amount: 2000, amount_refunded: 2000 } } }
  }
  beforeEach(() => {
    prisma.registration.findFirst.mockResolvedValue(null)
    sessionsList.mockResolvedValue({ data: [{ id: "cs_early" }] })
  })

  it("defers with 500 while the staging row is still OPEN", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    constructEvent.mockReturnValue(refundEvent())
    prisma.checkoutSession.findUnique.mockResolvedValue({ status: "OPEN", publicToken: null })
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 500 })
    expect(sessionsList).toHaveBeenCalledWith({ payment_intent: "pi_early", limit: 1 })
    expect(prisma.checkoutSession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeSessionId: "cs_early" } }))
    expect(prisma.registration.update).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it("defers a dispute while completion is mid-persist (COMPLETED, no token yet)", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    constructEvent.mockReturnValue({ type: "charge.dispute.created",
      data: { object: { id: "dp_e", payment_intent: "pi_early" } } })
    prisma.checkoutSession.findUnique.mockResolvedValue({ status: "COMPLETED", publicToken: null })
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 500 })
    errSpy.mockRestore()
  })

  it("acknowledges when the checkout is settled but no registration carries this PI (e.g. second charge on a bank-paid booking)", async () => {
    constructEvent.mockReturnValue(refundEvent())
    prisma.checkoutSession.findUnique.mockResolvedValue({ status: "COMPLETED", publicToken: "tok" })
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
    expect(prisma.registration.update).not.toHaveBeenCalled()
  })

  it("cancels a registration that completion created while the session was being resolved", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    constructEvent.mockReturnValue(refundEvent())
    prisma.registration.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 21, eventId: 7, paymentStatus: "PAID" })
    prisma.checkoutSession.findUnique.mockResolvedValue({ status: "COMPLETED", publicToken: "tok" })
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
    expect(prisma.registration.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 21 }, data: { paymentStatus: "CANCELLED" } }))
    errSpy.mockRestore()
  })

  it("acknowledges when the checkout terminated without a registration (UNFULFILLED)", async () => {
    constructEvent.mockReturnValue(refundEvent())
    prisma.checkoutSession.findUnique.mockResolvedValue({ status: "UNFULFILLED", publicToken: null })
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  })
})

it("no-ops when the registration is already CANCELLED", async () => {
  constructEvent.mockReturnValue({ type: "charge.dispute.created",
    data: { object: { id: "dp_2", payment_intent: "pi_4" } } })
  prisma.registration.findFirst.mockResolvedValue({ id: 13, eventId: 7, paymentStatus: "CANCELLED" })
  expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
  expect(prisma.registration.update).not.toHaveBeenCalled()
})

describe("existing-registration pay-now (staging.registrationId set)", () => {
  beforeEach(() => {
    // findUnique of the staging row returns a registration-linked row.
    prisma.checkoutSession.findUnique.mockResolvedValue({
      id: 7, status: "OPEN", registrationId: 42, surchargeCents: 0, eventId: 3,
    })
    prisma.registration.findUnique.mockResolvedValue({
      id: 42, publicToken: "tok-42", totalAmount: "20.00", eventId: 3, paymentStatus: "PENDING",
    })
    prisma.registration.updateMany.mockResolvedValue({ count: 1 })
  })

  it("marks the registration PAID and stamps paymentRef, and backfills the staging token", async () => {
    constructEvent.mockReturnValue(completedEvent("cs_pay", "pi_9", 2000))
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
    expect(prisma.registration.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 42, paymentStatus: "PENDING" },
      data: expect.objectContaining({ paymentStatus: "PAID", paymentRef: "pi_9" }),
    }))
    expect(prisma.checkoutSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7 }, data: { publicToken: "tok-42" },
    }))
    expect(persistRegistration).not.toHaveBeenCalled()
  })

  it("keeps the money and alerts when the registration is already settled by a DIFFERENT/absent charge (genuine double pay)", async () => {
    // reg has no paymentRef (e.g. bank-reconciled PAID) → this card charge is a
    // genuine second payment for an already-settled seat.
    prisma.registration.findUnique.mockResolvedValue({
      id: 42, publicToken: "tok-42", totalAmount: "20.00", eventId: 3, paymentRef: null,
    })
    prisma.registration.updateMany.mockResolvedValue({ count: 0 }) // already PAID
    constructEvent.mockReturnValue(completedEvent("cs_pay", "pi_9", 2000))
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
    expect(notifyStripeAlert).toHaveBeenCalled()
    // still resolves the success page to the paid registration
    expect(prisma.checkoutSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7 }, data: { publicToken: "tok-42" },
    }))
    errSpy.mockRestore()
  })

  it("does NOT alert on a same-session redelivery (row already PAID by THIS PaymentIntent) — only backfills the token ( parity)", async () => {
    // A prior pass marked the reg PAID with this PI then died before the token
    // write; Stripe redelivers. updateMany affects 0 rows, but reg.paymentRef ===
    // this PI, so it's the same charge — must NOT fire a false double-pay alert.
    prisma.registration.findUnique.mockResolvedValue({
      id: 42, publicToken: "tok-42", totalAmount: "20.00", eventId: 3, paymentRef: "pi_9",
    })
    prisma.registration.updateMany.mockResolvedValue({ count: 0 })
    constructEvent.mockReturnValue(completedEvent("cs_pay", "pi_9", 2000))
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
    expect(notifyStripeAlert).not.toHaveBeenCalled()
    // still backfills the token so the success page resolves to the paid reg
    expect(prisma.checkoutSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7 }, data: { publicToken: "tok-42" },
    }))
    errSpy.mockRestore()
  })

  it("does not mark PAID on an amount mismatch — UNFULFILLED + alert, money kept", async () => {
    constructEvent.mockReturnValue(completedEvent("cs_pay", "pi_9", 1999)) // expected 2000
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
    expect(prisma.registration.updateMany).not.toHaveBeenCalled()
    expect(prisma.checkoutSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7 }, data: { status: "UNFULFILLED" },
    }))
    expect(notifyStripeAlert).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
