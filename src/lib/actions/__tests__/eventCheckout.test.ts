/** @jest-environment node */

// startEventCheckout's other security gates (Stripe-not-configured, rate-limit,
// unpublished/past event, online-payment-disabled, free-event) are already
// covered by src/lib/__tests__/eventCheckout.test.ts ( review). The one
// guard missing there is the trusted-base-URL config check (line ~68 of
// src/lib/actions/eventCheckout.ts) — it only bites when NODE_ENV=production
// and neither AUTH_URL nor APP_URL is set, so it needs its own env setup.
// Mock style mirrors that file.

jest.mock("next/headers", () => ({
  headers: jest.fn(),
}))
jest.mock("@/lib/stripe", () => ({
  stripeConfigured: jest.fn(),
}))
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(),
}))
jest.mock("@/lib/eventRegistrationPricing", () => ({
  fetchEventWithTickets: jest.fn(),
  validateAndPriceRegistration: jest.fn(),
}))
jest.mock("@/lib/stripeCheckout", () => ({
  createEventCheckoutSession: jest.fn(),
}))

import { startEventCheckout } from "../eventCheckout"
import { headers } from "next/headers"
import { stripeConfigured } from "@/lib/stripe"
import { rateLimit } from "@/lib/rateLimit"
import { fetchEventWithTickets, validateAndPriceRegistration } from "@/lib/eventRegistrationPricing"
import { createEventCheckoutSession } from "@/lib/stripeCheckout"

const headersMock = headers as jest.Mock
const stripeConfiguredMock = stripeConfigured as jest.Mock
const rateLimitMock = rateLimit as jest.Mock
const fetchEventMock = fetchEventWithTickets as jest.Mock
const validateMock = validateAndPriceRegistration as jest.Mock
const createCheckoutMock = createEventCheckoutSession as jest.Mock

function makeHeaders(map: Record<string, string> = {}) {
  return { get: (k: string) => map[k] ?? null }
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: "fete",
    title: "Spring Fete",
    isPublished: true,
    date: null,
    endDate: null,
    onlinePaymentEnabled: true,
    ...overrides,
  }
}

const rawBody = { firstName: "Jane", lastName: "Doe", email: "jane@example.com", tickets: { "1": 1 } }

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
  stripeConfiguredMock.mockReturnValue(true)
  rateLimitMock.mockReturnValue(true)
  fetchEventMock.mockResolvedValue(makeEvent())
  validateMock.mockResolvedValue({
    ok: true,
    priced: { totalAmount: 20, items: [], firstName: "Jane", lastName: "Doe", email: "jane@example.com", emailHash: "hash", capacityChecks: [] },
  })
  createCheckoutMock.mockResolvedValue({ url: "https://checkout.stripe.com/session/abc" })
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

test("missing trusted base URL in production (no AUTH_URL/APP_URL) → 500, never trusts the origin header, Stripe not invoked", async () => {
  (process.env as Record<string, string>).NODE_ENV = "production"
  delete process.env.AUTH_URL
  delete process.env.APP_URL
  // Even though an origin header is present, prod must never fall back to it —
  // a spoofed header would be an open-redirect off the back of a real payment.
  headersMock.mockResolvedValue(
    makeHeaders({ "x-forwarded-for": "1.2.3.4", origin: "https://evil.example.com" }),
  )

  const result = await startEventCheckout("fete", rawBody)

  expect(result).toEqual({ ok: false, status: 500, error: "Payment configuration error" })
  expect(createCheckoutMock).not.toHaveBeenCalled()
})

test("AUTH_URL present in production → succeeds using the trusted base, not the origin header", async () => {
  (process.env as Record<string, string>).NODE_ENV = "production"
  process.env.AUTH_URL = "https://app.example.org"
  delete process.env.APP_URL
  headersMock.mockResolvedValue(
    makeHeaders({ "x-forwarded-for": "1.2.3.4", origin: "https://evil.example.com" }),
  )

  const result = await startEventCheckout("fete", rawBody)

  expect(result).toEqual({ ok: true, url: "https://checkout.stripe.com/session/abc" })
  expect(createCheckoutMock).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    "https://app.example.org",
  )
})

test("price the configured currency can't charge (fractional zero-decimal) → handled 400, not a thrown 500", async () => {
  process.env.AUTH_URL = "https://app.example.com"
  headersMock.mockResolvedValue(makeHeaders({ "x-forwarded-for": "1.2.3.4" }))
  const { CurrencyPrecisionError } = jest.requireActual("@/lib/stripeAmount")
  createCheckoutMock.mockRejectedValueOnce(new CurrencyPrecisionError(100050, "JPY"))

  const result = await startEventCheckout("fete", rawBody)

  expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining("JPY") })
})
