/** @jest-environment node */

jest.mock("@/lib/stripe", () => ({ stripeConfigured: jest.fn() }))
jest.mock("@/lib/eventRegistrationPricing", () => ({
  fetchEventWithTickets: jest.fn(),
  validateAndPriceRegistration: jest.fn(),
}))
jest.mock("@/lib/stripeCheckout", () => ({ createEventCheckoutSession: jest.fn() }))

let headerValues: Record<string, string> = {}
jest.mock("next/headers", () => ({
  headers: jest.fn().mockImplementation(async () => ({
    get: (name: string) => headerValues[name] ?? null,
  })),
}))

import { startEventCheckout } from "@/lib/actions/eventCheckout"
import { stripeConfigured } from "@/lib/stripe"
import { fetchEventWithTickets, validateAndPriceRegistration } from "@/lib/eventRegistrationPricing"
import { createEventCheckoutSession } from "@/lib/stripeCheckout"
import { __resetRateLimit } from "@/lib/rateLimit"

const mockConfigured = stripeConfigured as jest.Mock
const mockFetchEvent = fetchEventWithTickets as jest.Mock
const mockValidateAndPrice = validateAndPriceRegistration as jest.Mock
const mockCreateSession = createEventCheckoutSession as jest.Mock

const mockEvent = {
  id: 1,
  isPublished: true,
  date: new Date("2999-01-01"),
  endDate: null,
  onlinePaymentEnabled: true,
  ticketTypes: [{ id: 1, name: "Adult", price: 45 }],
}

const pricedOk = {
  ok: true as const,
  priced: {
    firstName: "A",
    lastName: "B",
    email: "a@b.com",
    emailHash: "hash",
    items: [],
    totalAmount: 45,
    capacityChecks: [],
  },
}

let ipCounter = 0
const nextIp = () => `10.1.0.${++ipCounter}`

beforeEach(() => {
  jest.clearAllMocks()
  __resetRateLimit()
  headerValues = { "x-forwarded-for": nextIp() }
  mockConfigured.mockReturnValue(true)
  mockFetchEvent.mockResolvedValue(mockEvent)
  mockValidateAndPrice.mockResolvedValue(pricedOk)
  mockCreateSession.mockResolvedValue({ url: "https://checkout.stripe.com/session/abc" })
  process.env.AUTH_URL = "https://app.example.com"
  delete process.env.APP_URL
})

describe("startEventCheckout", () => {
  it("returns 400 when Stripe is not configured", async () => {
    mockConfigured.mockReturnValue(false)
    const res = await startEventCheckout("harvest", {})
    expect(res).toEqual({ ok: false, status: 400, error: "Online payment unavailable" })
    expect(mockFetchEvent).not.toHaveBeenCalled()
  })

  it("returns 429 after 10 requests/min from the same IP", async () => {
    headerValues["x-forwarded-for"] = "10.9.9.9"
    for (let i = 0; i < 10; i++) {
      const res = await startEventCheckout("harvest", {})
      expect(res.ok).toBe(true)
    }
    const res = await startEventCheckout("harvest", {})
    expect(res).toEqual({ ok: false, status: 429, error: "Too many attempts" })
  })

  it("returns 404 when the event is not found", async () => {
    mockFetchEvent.mockResolvedValue(null)
    const res = await startEventCheckout("nope", {})
    expect(res).toEqual({ ok: false, status: 404, error: "Event not found" })
  })

  it("returns 404 when the event is unpublished — indistinguishable from not-found", async () => {
    mockFetchEvent.mockResolvedValue({ ...mockEvent, isPublished: false })
    const res = await startEventCheckout("harvest", {})
    expect(res).toEqual({ ok: false, status: 404, error: "Event not found" })
  })

  it("returns 404 for a past event", async () => {
    mockFetchEvent.mockResolvedValue({ ...mockEvent, date: new Date("2020-01-01"), endDate: null })
    const res = await startEventCheckout("harvest", {})
    expect(res).toEqual({ ok: false, status: 404, error: "Event not found" })
  })

  it("returns 400 when online payment is not enabled for the event", async () => {
    mockFetchEvent.mockResolvedValue({ ...mockEvent, onlinePaymentEnabled: false })
    const res = await startEventCheckout("harvest", {})
    expect(res).toEqual({ ok: false, status: 400, error: "Online payment not enabled for this event" })
  })

  it("propagates a validation error from validateAndPriceRegistration", async () => {
    mockValidateAndPrice.mockResolvedValue({ ok: false, status: 400, error: "Bad ticket selection" })
    const res = await startEventCheckout("harvest", {})
    expect(res).toEqual({ ok: false, status: 400, error: "Bad ticket selection" })
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it("returns 400 for a free event (totalAmount <= 0) — register without payment instead", async () => {
    mockValidateAndPrice.mockResolvedValue({
      ok: true,
      priced: { ...pricedOk.priced, totalAmount: 0 },
    })
    const res = await startEventCheckout("harvest", {})
    expect(res).toEqual({ ok: false, status: 400, error: "This event is free — register without payment" })
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it("resolves the trusted base from AUTH_URL and returns the Stripe checkout url (happy path)", async () => {
    const res = await startEventCheckout("harvest", {})
    expect(res).toEqual({ ok: true, url: "https://checkout.stripe.com/session/abc" })
    expect(mockCreateSession).toHaveBeenCalledWith(mockEvent, pricedOk.priced, "https://app.example.com")
  })

  it("falls back to APP_URL when AUTH_URL is unset", async () => {
    delete process.env.AUTH_URL
    process.env.APP_URL = "https://backup.example.com"
    const res = await startEventCheckout("harvest", {})
    expect(res.ok).toBe(true)
    expect(mockCreateSession).toHaveBeenCalledWith(mockEvent, pricedOk.priced, "https://backup.example.com")
  })

  it("dev-only: falls back to the origin header when no trusted base is configured outside production", async () => {
    delete process.env.AUTH_URL
    delete process.env.APP_URL
    const env = process.env as Record<string, string | undefined>
    const prevEnv = env.NODE_ENV
    env.NODE_ENV = "test"
    headerValues.origin = "http://localhost:3000"
    try {
      const res = await startEventCheckout("harvest", {})
      expect(res.ok).toBe(true)
      expect(mockCreateSession).toHaveBeenCalledWith(mockEvent, pricedOk.priced, "http://localhost:3000")
    } finally {
      env.NODE_ENV = prevEnv
    }
  })

  it("returns 500 in production when no trusted base is configured — never trusts the origin header for a payment redirect", async () => {
    delete process.env.AUTH_URL
    delete process.env.APP_URL
    const env = process.env as Record<string, string | undefined>
    const prevEnv = env.NODE_ENV
    env.NODE_ENV = "production"
    headerValues.origin = "http://attacker.example.com"
    try {
      const res = await startEventCheckout("harvest", {})
      expect(res).toEqual({ ok: false, status: 500, error: "Payment configuration error" })
      expect(mockCreateSession).not.toHaveBeenCalled()
    } finally {
      env.NODE_ENV = prevEnv
    }
  })
})
