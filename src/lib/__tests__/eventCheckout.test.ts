// Coverage for startEventCheckout's public security gates (Task 4 review
// finding — this action holds every gate but had zero tests). One assertion
// per gate proving it rejects with the EXACT status/error the source returns,
// plus a happy path proving the server-priced object flows through to
// createEventCheckoutSession untouched. Mock style follows
// eventRegistration.characterization.test.ts.

jest.mock("next/headers", () => ({
  headers: jest.fn(),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: { event: { findUnique: jest.fn() } },
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

import { startEventCheckout } from "@/lib/actions/eventCheckout"
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

beforeEach(() => {
  jest.clearAllMocks()
  stripeConfiguredMock.mockReturnValue(true)
  rateLimitMock.mockReturnValue(true)
  headersMock.mockResolvedValue(
    makeHeaders({ "x-forwarded-for": "1.2.3.4", origin: "https://example.com" }),
  )
  fetchEventMock.mockResolvedValue(makeEvent())
  validateMock.mockResolvedValue({
    ok: true,
    priced: { totalAmount: 20, items: [], firstName: "Jane", lastName: "Doe", email: "jane@example.com", emailHash: "hash", capacityChecks: [] },
  })
  createCheckoutMock.mockResolvedValue({ url: "https://checkout.stripe.com/session/abc" })
})

describe("startEventCheckout — security gates", () => {
  it("Stripe not configured → { ok: false, status: 400 }", async () => {
    stripeConfiguredMock.mockReturnValue(false)
    const result = await startEventCheckout("fete", rawBody)
    expect(result).toEqual({ ok: false, status: 400, error: "Online payment unavailable" })
    expect(fetchEventMock).not.toHaveBeenCalled()
  })

  it("rate limited → { ok: false, status: 429 }", async () => {
    rateLimitMock.mockReturnValue(false)
    const result = await startEventCheckout("fete", rawBody)
    expect(result).toEqual({ ok: false, status: 429, error: "Too many attempts" })
    expect(fetchEventMock).not.toHaveBeenCalled()
  })

  it("event not found → { ok: false, status: 404 }", async () => {
    fetchEventMock.mockResolvedValue(null)
    const result = await startEventCheckout("nope", rawBody)
    expect(result).toEqual({ ok: false, status: 404, error: "Event not found" })
  })

  it("unpublished event → { ok: false, status: 404 } (indistinguishable from missing)", async () => {
    fetchEventMock.mockResolvedValue(makeEvent({ isPublished: false }))
    const result = await startEventCheckout("fete", rawBody)
    expect(result).toEqual({ ok: false, status: 404, error: "Event not found" })
  })

  it("past event → { ok: false, status: 404 }", async () => {
    fetchEventMock.mockResolvedValue(makeEvent({ date: new Date("2000-01-01") }))
    const result = await startEventCheckout("fete", rawBody)
    expect(result).toEqual({ ok: false, status: 404, error: "Event not found" })
  })

  it("registration closed (manual flag) → { ok: false, status: 400 } — mirrors the bank-transfer path", async () => {
    fetchEventMock.mockResolvedValue(makeEvent({ registrationClosed: true }))
    const result = await startEventCheckout("fete", rawBody)
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Registration for this event is closed.",
    })
    expect(createCheckoutMock).not.toHaveBeenCalled()
  })

  it("registration deadline passed → { ok: false, status: 400 }", async () => {
    fetchEventMock.mockResolvedValue(
      makeEvent({ registrationDeadline: new Date("2000-01-01") }),
    )
    const result = await startEventCheckout("fete", rawBody)
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Registration for this event is closed.",
    })
    expect(createCheckoutMock).not.toHaveBeenCalled()
  })

  it("online payment not enabled → { ok: false, status: 400 }", async () => {
    fetchEventMock.mockResolvedValue(makeEvent({ onlinePaymentEnabled: false }))
    const result = await startEventCheckout("fete", rawBody)
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Online payment not enabled for this event",
    })
  })

  it("free event (priced total <= 0) → { ok: false, status: 400 }", async () => {
    validateMock.mockResolvedValue({
      ok: true,
      priced: { totalAmount: 0, items: [], firstName: "Jane", lastName: "Doe", email: "jane@example.com", emailHash: "hash", capacityChecks: [] },
    })
    const result = await startEventCheckout("fete", rawBody)
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "This event is free — register without payment",
    })
    expect(createCheckoutMock).not.toHaveBeenCalled()
  })

  it("validateAndPriceRegistration rejection is passed through unchanged", async () => {
    validateMock.mockResolvedValue({ ok: false, status: 400, error: "Select at least one ticket" })
    const result = await startEventCheckout("fete", rawBody)
    expect(result).toEqual({ ok: false, status: 400, error: "Select at least one ticket" })
    expect(createCheckoutMock).not.toHaveBeenCalled()
  })
})

describe("startEventCheckout — happy path", () => {
  it("returns { ok: true, url } and calls createEventCheckoutSession with the server-priced object", async () => {
    const event = makeEvent()
    fetchEventMock.mockResolvedValue(event)
    const priced = { totalAmount: 20, items: [], firstName: "Jane", lastName: "Doe", email: "jane@example.com", emailHash: "hash", capacityChecks: [] }
    validateMock.mockResolvedValue({ ok: true, priced })

    const result = await startEventCheckout("fete", rawBody)

    expect(result).toEqual({ ok: true, url: "https://checkout.stripe.com/session/abc" })
    expect(createCheckoutMock).toHaveBeenCalledWith(event, priced, "https://example.com")
  })
})
