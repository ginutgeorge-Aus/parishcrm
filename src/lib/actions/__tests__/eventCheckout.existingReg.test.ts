/** @jest-environment node */
jest.mock("@/lib/featureFlags")
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

import { startEventCheckout, startExistingRegistrationCheckout } from "../eventCheckout"
import { featureGuard } from "@/lib/featureFlags"
import { headers } from "next/headers"
import { stripeConfigured } from "@/lib/stripe"
import { rateLimit } from "@/lib/rateLimit"
import { createExistingRegistrationCheckoutSession, RegistrationNotPayableError } from "@/lib/stripeCheckout"
import { prisma } from "@/lib/prisma"
import { REGISTRATION_LINK_EXPIRED_MESSAGE } from "@/lib/registrationLink"

const mHeaders = headers as jest.Mock
const mStripe = stripeConfigured as jest.Mock
const mRate = rateLimit as jest.Mock
const mCreate = createExistingRegistrationCheckoutSession as jest.Mock
const mEvent = prisma.event.findUnique as jest.Mock
const mReg = prisma.registration.findFirst as jest.Mock

function evt(o = {}) { return { id: 3, slug: "fete", title: "Fete", isPublished: true, onlinePaymentEnabled: true, passCardFee: false, ticketTypes: [{ id: 9, name: "Adult" }], ...o } }
function reg(o = {}) { return { id: 42, publicToken: "REG-AABBCCDDEEFF", paymentStatus: "PENDING", totalAmount: "20.00", items: [{ ticketTypeId: 9, quantity: 1, unitPrice: "20.00" }], ...o } }

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
  const res = await startExistingRegistrationCheckout("fete", "REG-AABBCCDDEEFF")
  expect(res).toEqual({ ok: true, url: "https://stripe.test/pay" })
  expect(mReg).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ publicToken: "REG-AABBCCDDEEFF", eventId: 3 }),
  }))
})

it("400s when Stripe is not configured", async () => {
  mStripe.mockReturnValue(false)
  expect(await startExistingRegistrationCheckout("fete", "REG-AABBCCDDEEFF")).toMatchObject({ ok: false, status: 400 })
})

it("400s when online payment is disabled for the event", async () => {
  mEvent.mockResolvedValue(evt({ onlinePaymentEnabled: false }))
  expect(await startExistingRegistrationCheckout("fete", "REG-AABBCCDDEEFF")).toMatchObject({ ok: false, status: 400 })
})

it("404s when no matching registration (wrong token / other event)", async () => {
  mReg.mockResolvedValue(null)
  expect(await startExistingRegistrationCheckout("fete", "REG-000000000000")).toEqual({
    ok: false, status: 404, error: REGISTRATION_LINK_EXPIRED_MESSAGE,
  })
})

it("400s when the registration is already paid", async () => {
  mReg.mockResolvedValue(reg({ paymentStatus: "PAID" }))
  const res = await startExistingRegistrationCheckout("fete", "REG-AABBCCDDEEFF")
  expect(res).toMatchObject({ ok: false, status: 400 })
  expect(mCreate).not.toHaveBeenCalled()
})

it("400s a free ($0) registration", async () => {
  mReg.mockResolvedValue(reg({ totalAmount: "0.00" }))
  expect(await startExistingRegistrationCheckout("fete", "REG-AABBCCDDEEFF")).toMatchObject({ ok: false, status: 400 })
})

it("400s when the registration settled or its prior checkout was paid mid-request", async () => {
  mCreate.mockRejectedValue(new RegistrationNotPayableError())
  expect(await startExistingRegistrationCheckout("fete", "REG-AABBCCDDEEFF")).toEqual({
    ok: false, status: 400, error: "This registration is not awaiting payment",
  })
})

it.each([
  ["startExistingRegistrationCheckout", () => startExistingRegistrationCheckout("fete", "REG-AABBCCDDEEFF")],
  ["startEventCheckout", () => startEventCheckout("fete", {})],
])("%s returns the public 'Event not found' 404 while Events is off (no admin wording)", async (_name, call) => {
  ;(featureGuard as jest.Mock).mockResolvedValueOnce({ error: "This feature is turned off in Settings → Features." })
  expect(await call()).toEqual({ ok: false, status: 404, error: "Event not found" })
  expect(mCreate).not.toHaveBeenCalled()
})

it.each([
  ["startExistingRegistrationCheckout", () => startExistingRegistrationCheckout("fete", "REG-AABBCCDDEEFF")],
  ["startEventCheckout", () => startEventCheckout("fete", {})],
])("%s rate-limits before the feature read", async (_name, call) => {
  mRate.mockReturnValueOnce(false)
  ;(featureGuard as jest.Mock).mockClear()
  expect(await call()).toMatchObject({ ok: false, status: 429 })
  expect(featureGuard).not.toHaveBeenCalled()
})

describe("token and slug shape (public callable, runtime types are caller-controlled)", () => {
  it("rejects a non-string publicToken before any registration lookup", async () => {
    const res = await startExistingRegistrationCheckout("fete", { not: "" } as unknown as string)
    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(mReg).not.toHaveBeenCalled()
  })

  it.each(["REG-xyz", "reg-aabbccddeeff", "REG-AABBCCDDEEFF'", ""])("rejects malformed token %j", async (t) => {
    expect(await startExistingRegistrationCheckout("fete", t)).toMatchObject({ ok: false, status: 404 })
    expect(mReg).not.toHaveBeenCalled()
  })

  it("rejects a non-string slug in both actions", async () => {
    const bad = { contains: "" } as unknown as string
    const notFound = { ok: false, status: 404, error: "Event not found" }
    expect(await startExistingRegistrationCheckout(bad, "REG-AABBCCDDEEFF")).toEqual(notFound)
    expect(await startEventCheckout(bad, {})).toEqual(notFound)
    expect(mEvent).not.toHaveBeenCalled()
  })

  it("applies the link-expiry filter so an expired link cannot start a checkout", async () => {
    await startExistingRegistrationCheckout("fete", "REG-AABBCCDDEEFF")
    const where = mReg.mock.calls[0][0].where
    const floor = (where.OR[0].createdAt.gte as Date).getTime()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(Date.now() - thirtyDays - floor)).toBeLessThan(5_000)
    expect(where.OR).toEqual([
      { createdAt: { gte: expect.any(Date) } },
      { paymentReminders: { some: { status: "SUCCESS", sentAt: { gte: expect.any(Date) } } } },
    ])
  })
})
