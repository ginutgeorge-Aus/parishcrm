/** @jest-environment node */
jest.mock("@/lib/featureFlags")
jest.mock("next/headers", () => ({ headers: jest.fn() }))
jest.mock("@/lib/stripe", () => ({ stripeConfigured: jest.fn() }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn() }))
jest.mock("@/lib/fundraiserCheckout", () => {
  class FundraiserNotPayableError extends Error {}
  return { createFundraiserCheckoutSession: jest.fn(), FundraiserNotPayableError }
})
jest.mock("@/lib/prisma", () => ({ prisma: { fundraiserEntry: { findUnique: jest.fn() } } }))

import { startFundraiserCheckout } from "../eventCheckout"
import { featureGuard } from "@/lib/featureFlags"
import { headers } from "next/headers"
import { stripeConfigured } from "@/lib/stripe"
import { rateLimit } from "@/lib/rateLimit"
import { createFundraiserCheckoutSession, FundraiserNotPayableError } from "@/lib/fundraiserCheckout"
import { CurrencyPrecisionError } from "@/lib/stripeAmount"
import { prisma } from "@/lib/prisma"

const mHeaders = headers as jest.Mock
const mStripe = stripeConfigured as jest.Mock
const mRate = rateLimit as jest.Mock
const mGuard = featureGuard as jest.Mock
const mCreate = createFundraiserCheckoutSession as jest.Mock
const mEntry = prisma.fundraiserEntry.findUnique as jest.Mock

/**
 * Build a fundraiser entry row as returned by the checkout lookup.
 * @param o field overrides (shallow)
 */
function entry(o = {}) {
  return {
    id: 7, publicToken: "tok_7", quantity: 2, unitPrice: "10.00", payments: [{ amount: "5.00" }],
    fundraiser: { event: { id: 3, slug: "fete", title: "Fete", passCardFee: false, onlinePaymentEnabled: true } },
    ...o,
  }
}

const originalEnv = { ...process.env }

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...originalEnv, AUTH_URL: "https://app.test" }
  mHeaders.mockResolvedValue({ get: () => "https://hdr.test" })
  mStripe.mockReturnValue(true)
  mRate.mockReturnValue(true)
  mGuard.mockResolvedValue(null)
  mEntry.mockResolvedValue(entry())
  mCreate.mockResolvedValue({ ok: true, url: "https://stripe.test/pay" })
})

afterAll(() => { process.env = originalEnv })

it("starts checkout for the remaining balance", async () => {
  expect(await startFundraiserCheckout("tok_7")).toEqual({ ok: true, url: "https://stripe.test/pay" })
  expect(mCreate).toHaveBeenCalledWith(
    { id: 7, publicToken: "tok_7", remainingCents: 1500 },
    expect.objectContaining({ slug: "fete" }),
    "https://app.test",
  )
})

it("400s when Stripe is not configured", async () => {
  mStripe.mockReturnValue(false)
  expect(await startFundraiserCheckout("tok_7")).toMatchObject({ ok: false, status: 400 })
})

it("429s when rate limited", async () => {
  mRate.mockReturnValue(false)
  expect(await startFundraiserCheckout("tok_7")).toMatchObject({ ok: false, status: 429 })
})

it("404s when the events feature is off", async () => {
  mGuard.mockResolvedValue("off")
  expect(await startFundraiserCheckout("tok_7")).toMatchObject({ ok: false, status: 404 })
})

it("404s a malformed token without a DB lookup", async () => {
  expect(await startFundraiserCheckout("bad token!")).toMatchObject({ ok: false, status: 404 })
  expect(mEntry).not.toHaveBeenCalled()
})

it("404s an unknown token", async () => {
  mEntry.mockResolvedValue(null)
  expect(await startFundraiserCheckout("tok_7")).toMatchObject({ ok: false, status: 404 })
})

it("400s when online payment is disabled", async () => {
  const e = entry()
  e.fundraiser.event.onlinePaymentEnabled = false
  mEntry.mockResolvedValue(e)
  expect(await startFundraiserCheckout("tok_7")).toMatchObject({ ok: false, status: 400 })
})

it("400s when nothing is left to pay", async () => {
  mEntry.mockResolvedValue(entry({ payments: [{ amount: "20.00" }] }))
  expect(await startFundraiserCheckout("tok_7")).toMatchObject({ ok: false, status: 400, error: "Nothing left to pay" })
})

it("500s when no trusted base URL in production", async () => {
  delete process.env.AUTH_URL
  delete process.env.APP_URL
  ;(process.env as Record<string, string>).NODE_ENV = "production"
  expect(await startFundraiserCheckout("tok_7")).toMatchObject({ ok: false, status: 500 })
})

it("falls back to the request origin outside production", async () => {
  delete process.env.AUTH_URL
  delete process.env.APP_URL
  ;(process.env as Record<string, string>).NODE_ENV = "test"
  await startFundraiserCheckout("tok_7")
  expect(mCreate).toHaveBeenCalledWith(expect.anything(), expect.anything(), "https://hdr.test")
})

it("maps FundraiserNotPayableError to 400", async () => {
  mCreate.mockRejectedValue(new FundraiserNotPayableError())
  expect(await startFundraiserCheckout("tok_7")).toMatchObject({ ok: false, status: 400 })
})

it("maps CurrencyPrecisionError to a handled 400", async () => {
  mCreate.mockRejectedValue(new CurrencyPrecisionError(150, "JPY"))
  expect(await startFundraiserCheckout("tok_7")).toMatchObject({ ok: false, status: 400 })
})

it("rethrows unexpected errors", async () => {
  mCreate.mockRejectedValue(new Error("boom"))
  await expect(startFundraiserCheckout("tok_7")).rejects.toThrow("boom")
})
