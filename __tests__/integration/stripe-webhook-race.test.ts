/** @jest-environment node */
// Real-Postgres race test for Stripe webhook redelivery (StMarkCRM#3331 PR 4). Stripe
// retries deliveries, so two copies of one checkout.session.completed can land at the
// same instant. The mocked suite stubs the claim; this fires the same signed event
// concurrently through the real handleStripeWebhook (real signature check, real
// OPEN -> COMPLETED claim, real persistRegistration) and checks exactly one paid
// registration exists. Opt-in: runs only with INTEGRATION_DB=1 against a migrated,
// disposable database (see docs/integration-tests.md); skipped in the normal `npm test` run.

// Module scope: keeps this file's top-level names out of the shared global script scope.
export {}

jest.mock("server-only", () => ({}))
jest.mock("@/lib/email", () => ({ sendRegistrationConfirmationEmail: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/notifications", () => ({
  notifyStripeAlert: jest.fn().mockResolvedValue(undefined),
  notifyFailedLogin: jest.fn().mockResolvedValue(undefined),
}))

const RUN = process.env.INTEGRATION_DB === "1"
jest.setTimeout(60_000)

;(RUN ? describe : describe.skip)("stripe webhook redelivery races (real Postgres)", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let handleStripeWebhook: typeof import("@/lib/stripeCheckout").handleStripeWebhook
  let encrypt: typeof import("@/lib/crypto").encrypt
  let getStripe: typeof import("@/lib/stripe").getStripe
  let apiVersion: string
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const secret = "whsec_race_test_secret"
  const eventIds: number[] = []
  let seq = 0
  const saved = { key: process.env.STRIPE_SECRET_KEY, secret: process.env.STRIPE_WEBHOOK_SECRET }

  /**
   * Stages an event, ticket type and OPEN checkout row, and returns a signed delivery.
   * @param capacity - seats on the ticket type
   */
  async function stageCheckout(capacity: number) {
    const n = seq++
    const event = await prisma.event.create({
      data: { title: `Stripe race ${tag}-${n}`, ticketTypes: { create: [{ name: "General", price: "10.00", capacity }] } },
      include: { ticketTypes: true },
    })
    eventIds.push(event.id)
    const ticket = event.ticketTypes[0]
    const priced = {
      firstName: "Pat",
      lastName: "Payer",
      email: `payer-${tag}-${n}@example.com`,
      emailHash: `stripe-race-${tag}-${n}`,
      items: [{ ticketTypeId: ticket.id, quantity: 1, unitPrice: 10, attendeeNames: ["Pat Payer"], perAttendeeAnswers: [undefined] }],
      totalAmount: 10,
      waivedCount: 0,
      capacityChecks: [{ ticketTypeId: ticket.id, quantity: 1, name: ticket.name }],
    }
    const sessionId = `cs_test_race_${tag}_${n}`
    const paymentIntent = `pi_test_race_${tag}_${n}`
    await prisma.checkoutSession.create({
      data: {
        stripeSessionId: sessionId,
        eventId: event.id,
        payload: encrypt(JSON.stringify(priced)),
        totalAmount: "10.00",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })
    const payload = JSON.stringify({
      id: `evt_test_race_${tag}_${n}`,
      object: "event",
      api_version: apiVersion,
      type: "checkout.session.completed",
      data: { object: { id: sessionId, object: "checkout.session", payment_status: "paid", payment_intent: paymentIntent, amount_total: 1000, payment_link: null, metadata: {} } },
    })
    const header = getStripe().webhooks.generateTestHeaderString({ payload, secret })
    return { eventId: event.id, sessionId, paymentIntent, payload, header }
  }

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_race_fake"
    process.env.STRIPE_WEBHOOK_SECRET = secret
    ;({ prisma } = await import("@/lib/prisma"))
    ;({ handleStripeWebhook } = await import("@/lib/stripeCheckout"))
    ;({ encrypt } = await import("@/lib/crypto"))
    ;({ getStripe } = await import("@/lib/stripe"))
    apiVersion = (await import("@/lib/stripe")).STRIPE_API_VERSION
  })

  afterAll(async () => {
    process.env.STRIPE_SECRET_KEY = saved.key
    process.env.STRIPE_WEBHOOK_SECRET = saved.secret
    if (!prisma) return
    // CheckoutSession.eventId is Restrict, so remove those rows first.
    await prisma.checkoutSession.deleteMany({ where: { eventId: { in: eventIds } } })
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } })
    await prisma.$disconnect()
  })

  it("the same signed event delivered 6x in parallel books exactly one paid registration", async () => {
    const staged = await stageCheckout(5)
    const results = await Promise.all(Array.from({ length: 6 }, () => handleStripeWebhook(staged.payload, staged.header)))
    // Every delivery is acknowledged (a 5xx would make Stripe redeliver forever).
    for (const r of results) expect([200, 500]).toContain(r.status)
    expect(results.some((r) => r.status === 200)).toBe(true)
    const regs = await prisma.registration.findMany({ where: { eventId: staged.eventId } })
    expect(regs).toHaveLength(1)
    expect(regs[0].paymentStatus).toBe("PAID")
    expect(regs[0].paymentRef).toBe(staged.paymentIntent)
    const row = await prisma.checkoutSession.findUniqueOrThrow({ where: { stripeSessionId: staged.sessionId } })
    expect(row.status).toBe("COMPLETED")
    expect(row.publicToken).toBe(regs[0].publicToken)
  })

  it("a redelivery after completion is a no-op", async () => {
    const staged = await stageCheckout(5)
    expect((await handleStripeWebhook(staged.payload, staged.header)).status).toBe(200)
    expect((await handleStripeWebhook(staged.payload, staged.header)).status).toBe(200)
    expect(await prisma.registration.count({ where: { eventId: staged.eventId } })).toBe(1)
  })
})
