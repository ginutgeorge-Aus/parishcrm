/** @jest-environment node */
jest.mock("next/headers", () => ({ headers: jest.fn() }))
jest.mock("@/lib/stripe", () => ({ stripeConfigured: jest.fn() }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn() }))
jest.mock("@/lib/stripeCheckout", () => {
  class RegistrationNotPayableError extends Error {}
  return { createExistingRegistrationCheckoutSession: jest.fn(), RegistrationNotPayableError }
})
jest.mock("@/lib/prisma", () => ({ prisma: {
  event: { findUnique: jest.fn() },
  registration: { findFirst: jest.fn() },
} }))

import { startExistingRegistrationCheckout } from "../eventCheckout"
import { headers } from "next/headers"
import { stripeConfigured } from "@/lib/stripe"
import { rateLimit } from "@/lib/rateLimit"
import { createExistingRegistrationCheckoutSession, RegistrationNotPayableError } from "@/lib/stripeCheckout"
import { prisma } from "@/lib/prisma"

const mHeaders = headers as jest.Mock
const mStripe = stripeConfigured as jest.Mock
const mRate = rateLimit as jest.Mock
const mCreate = createExistingRegistrationCheckoutSession as jest.Mock
const mEvent = prisma.event.findUnique as jest.Mock
const mReg = prisma.registration.findFirst as jest.Mock

function evt(o = {}) { return { id: 3, slug: "fete", title: "Fete", isPublished: true, onlinePaymentEnabled: true, passCardFee: false, ticketTypes: [{ id: 9, name: "Adult" }], ...o } }
function reg(o = {}) { return { id: 42, publicToken: "tok-42", paymentStatus: "PENDING", totalAmount: "20.00", items: [{ ticketTypeId: 9, quantity: 1, unitPrice: "20.00" }], ...o } }

beforeEach(() => {
  jest.clearAllMocks()
  process.env.AUTH_URL = "https://app.test"
  mHeaders.mockResolvedValue({ get: () => "1.2.3.4" })
  mStripe.mockReturnValue(true)
  mRate.mockReturnValue(true)
  mEvent.mockResolvedValue(evt())
  mReg.mockResolvedValue(reg())
  mCreate.mockResolvedValue({ url: "https://stripe.test/pay" })
})

it("starts checkout for a PENDING registration (event-scoped lookup)", async () => {
  const res = await startExistingRegistrationCheckout("fete", "tok-42")
  expect(res).toEqual({ ok: true, url: "https://stripe.test/pay" })
  expect(mReg).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ publicToken: "tok-42", eventId: 3 }),
  }))
})

it("400s when Stripe is not configured", async () => {
  mStripe.mockReturnValue(false)
  expect(await startExistingRegistrationCheckout("fete", "tok-42")).toMatchObject({ ok: false, status: 400 })
})

it("400s when online payment is disabled for the event", async () => {
  mEvent.mockResolvedValue(evt({ onlinePaymentEnabled: false }))
  expect(await startExistingRegistrationCheckout("fete", "tok-42")).toMatchObject({ ok: false, status: 400 })
})

it("404s when no matching registration (wrong token / other event)", async () => {
  mReg.mockResolvedValue(null)
  expect(await startExistingRegistrationCheckout("fete", "nope")).toMatchObject({ ok: false, status: 404 })
})

it("400s when the registration is already paid", async () => {
  mReg.mockResolvedValue(reg({ paymentStatus: "PAID" }))
  const res = await startExistingRegistrationCheckout("fete", "tok-42")
  expect(res).toMatchObject({ ok: false, status: 400 })
  expect(mCreate).not.toHaveBeenCalled()
})

it("400s a free ($0) registration", async () => {
  mReg.mockResolvedValue(reg({ totalAmount: "0.00" }))
  expect(await startExistingRegistrationCheckout("fete", "tok-42")).toMatchObject({ ok: false, status: 400 })
})

it("400s when the registration settled or its prior checkout was paid mid-request", async () => {
  mCreate.mockRejectedValue(new RegistrationNotPayableError())
  expect(await startExistingRegistrationCheckout("fete", "tok-42")).toEqual({
    ok: false, status: 400, error: "This registration is not awaiting payment",
  })
})
