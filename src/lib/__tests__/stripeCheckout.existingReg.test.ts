/** @jest-environment node */
jest.mock("@/lib/stripe", () => {
  const sessions = { create: jest.fn(), retrieve: jest.fn(), expire: jest.fn() }
  return { getStripe: () => ({ checkout: { sessions } }) }
})
jest.mock("@/lib/prisma", () => {
  const checkoutSession = { create: jest.fn(), findMany: jest.fn() }
  const registration = { updateMany: jest.fn() }
  const tx = { checkoutSession, registration }
  return { prisma: { ...tx, $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } }
})
jest.mock("@/lib/cardFeeSettings", () => ({ getCardFeeConfig: jest.fn() }))

import { createExistingRegistrationCheckoutSession, RegistrationNotPayableError } from "@/lib/stripeCheckout"
const { getStripe } = require("@/lib/stripe")
const { prisma } = require("@/lib/prisma")
const sessionsCreate = getStripe().checkout.sessions.create
const sessionsRetrieve = getStripe().checkout.sessions.retrieve

const event = { id: 3, slug: "fete", title: "Fete", passCardFee: false, ticketTypes: [{ id: 9, name: "Adult" }] }
const registration = {
  id: 42, publicToken: "tok-42", totalAmount: "20.00",
  items: [{ ticketTypeId: 9, quantity: 1, unitPrice: "20.00" }],
}

beforeEach(() => {
  jest.clearAllMocks()
  sessionsCreate.mockResolvedValue({ id: "cs_new", url: "https://stripe.test/pay" })
  prisma.registration.updateMany.mockResolvedValue({ count: 1 })
  prisma.checkoutSession.findMany.mockResolvedValue([])
})

it("stages a CheckoutSession carrying registrationId with an empty payload", async () => {
  const res = await createExistingRegistrationCheckoutSession(event, registration, "https://app.test")
  expect(res).toEqual({ url: "https://stripe.test/pay" })
  const staged = prisma.checkoutSession.create.mock.calls[0][0].data
  expect(staged).toMatchObject({ stripeSessionId: "cs_new", eventId: 3, registrationId: 42, payload: "", surchargeCents: 0 })
})

it("returns to the pending success page on cancel", async () => {
  await createExistingRegistrationCheckoutSession(event, registration, "https://app.test")
  const args = sessionsCreate.mock.calls[0][0]
  expect(args.success_url).toBe("https://app.test/e/fete/success?token={CHECKOUT_SESSION_ID}")
  expect(args.cancel_url).toBe("https://app.test/e/fete/success?ref=tok-42")
})

// two concurrent pay-now clicks (two tabs, reminder link + button) must
// not each open a separately payable Stripe session for one registration.
describe("concurrent pay-now", () => {
  const future = () => Math.floor(Date.now() / 1000) + 20 * 60

  it("row-locks the PENDING registration inside a transaction", async () => {
    await createExistingRegistrationCheckoutSession(event, registration, "https://app.test")
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.registration.updateMany).toHaveBeenCalledWith({
      where: { id: 42, paymentStatus: "PENDING" }, data: { paymentStatus: "PENDING" },
    })
  })

  it("throws RegistrationNotPayableError when the registration settled meanwhile", async () => {
    prisma.registration.updateMany.mockResolvedValue({ count: 0 })
    await expect(createExistingRegistrationCheckoutSession(event, registration, "https://app.test"))
      .rejects.toBeInstanceOf(RegistrationNotPayableError)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("includes webhook-claimed (COMPLETED, no token) rows in the same query, and refuses when Stripe says paid", async () => {
    prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_claimed" }])
    sessionsRetrieve.mockResolvedValue({ id: "cs_claimed", status: "complete", url: null, expires_at: future() })
    await expect(createExistingRegistrationCheckoutSession(event, registration, "https://app.test"))
      .rejects.toBeInstanceOf(RegistrationNotPayableError)
    expect(prisma.checkoutSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { registrationId: 42, OR: [{ status: "OPEN" }, { status: "COMPLETED", publicToken: null }] },
    }))
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("reuses a still-open Stripe session instead of creating a second", async () => {
    prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_old" }])
    sessionsRetrieve.mockResolvedValue({ id: "cs_old", status: "open", url: "https://stripe.test/old", expires_at: future() })
    const res = await createExistingRegistrationCheckoutSession(event, registration, "https://app.test")
    expect(res).toEqual({ url: "https://stripe.test/old" })
    expect(sessionsCreate).not.toHaveBeenCalled()
    expect(prisma.checkoutSession.create).not.toHaveBeenCalled()
  })

  it("refuses a new session when the prior one is already paid but its webhook hasn't landed", async () => {
    prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_old" }])
    sessionsRetrieve.mockResolvedValue({ id: "cs_old", status: "complete", url: null, expires_at: future() })
    await expect(createExistingRegistrationCheckoutSession(event, registration, "https://app.test"))
      .rejects.toBeInstanceOf(RegistrationNotPayableError)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("expires every older live duplicate, reusing only the newest ( legacy rows)", async () => {
    prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_new1" }, { stripeSessionId: "cs_old1" }])
    sessionsRetrieve.mockImplementation(async (id: string) =>
      ({ id, status: "open", url: `https://stripe.test/${id}`, expires_at: future() }))
    const res = await createExistingRegistrationCheckoutSession(event, registration, "https://app.test")
    expect(res).toEqual({ url: "https://stripe.test/cs_new1" })
    expect(getStripe().checkout.sessions.expire).toHaveBeenCalledWith("cs_old1")
    expect(getStripe().checkout.sessions.expire).not.toHaveBeenCalledWith("cs_new1")
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("refuses if ANY prior session is already paid, even an older one", async () => {
    prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_new1" }, { stripeSessionId: "cs_old1" }])
    sessionsRetrieve.mockImplementation(async (id: string) =>
      ({ id, status: id === "cs_old1" ? "complete" : "open", url: "https://stripe.test/x", expires_at: future() }))
    await expect(createExistingRegistrationCheckoutSession(event, registration, "https://app.test"))
      .rejects.toBeInstanceOf(RegistrationNotPayableError)
    // The newer still-open session must not stay payable alongside the paid one.
    expect(getStripe().checkout.sessions.expire).toHaveBeenCalledWith("cs_new1")
  })

  it("expires the just-created Stripe session when the staging write fails", async () => {
    prisma.checkoutSession.create.mockRejectedValueOnce(new Error("Transaction already closed"))
    await expect(createExistingRegistrationCheckoutSession(event, registration, "https://app.test"))
      .rejects.toThrow("Transaction already closed")
    expect(getStripe().checkout.sessions.expire).toHaveBeenCalledWith("cs_new")
  })

  it("creates a fresh session when the prior one expired or is about to", async () => {
    prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_old" }])
    sessionsRetrieve.mockResolvedValue({ id: "cs_old", status: "open", url: "https://stripe.test/old", expires_at: Math.floor(Date.now() / 1000) + 60 })
    const res = await createExistingRegistrationCheckoutSession(event, registration, "https://app.test")
    expect(res).toEqual({ url: "https://stripe.test/pay" })
    // The near-expiry session is expired so it can't be paid alongside the new one.
    expect(getStripe().checkout.sessions.expire).toHaveBeenCalledWith("cs_old")
  })
})
