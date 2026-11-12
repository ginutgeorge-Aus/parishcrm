/** @jest-environment node */
// Fundraiser card pay link: Stripe Checkout for an entry's remaining balance.
jest.mock("@/lib/stripe", () => {
  const sessions = { create: jest.fn(), retrieve: jest.fn(), expire: jest.fn() }
  return { getStripe: () => ({ checkout: { sessions } }), stripeConfigured: () => true }
})
jest.mock("next/headers", () => ({ headers: jest.fn().mockResolvedValue(new Headers({ "x-forwarded-for": "1.2.3.4" })) }))
jest.mock("@/lib/clientIp", () => ({ rateKeyFromHeaders: () => "1.2.3.4", resolveClientIp: () => ({ ip: "1.2.3.4", key: "1.2.3.4" }) }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn() }))
jest.mock("@/lib/featureFlags", () => ({ featureGuard: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const checkoutSession = { create: jest.fn(), findMany: jest.fn() }
  const fundraiserEntry = { findUnique: jest.fn() }
  const tx = { checkoutSession, fundraiserEntry, $queryRaw: jest.fn() }
  return { prisma: { ...tx, $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } }
})
jest.mock("@/lib/cardFeeSettings", () => ({ getCardFeeConfig: jest.fn() }))

import {
  createFundraiserCheckoutSession,
  fundraiserSurchargeCents,
  FundraiserNotPayableError,
} from "@/lib/fundraiserCheckout"
import { grossUpTotal } from "@/lib/cardFee"
const { getStripe } = require("@/lib/stripe")
const { prisma } = require("@/lib/prisma")
const { getCardFeeConfig } = require("@/lib/cardFeeSettings")
const sessionsCreate = getStripe().checkout.sessions.create
const sessionsRetrieve = getStripe().checkout.sessions.retrieve
const sessionsExpire = getStripe().checkout.sessions.expire

const event = { id: 3, slug: "feast", title: "Feast", passCardFee: false }
const entry = { id: 7, publicToken: "tok-7", remainingCents: 3000 }
const future = () => Math.floor(Date.now() / 1000) + 20 * 60

beforeEach(() => {
  jest.clearAllMocks()
  sessionsCreate.mockResolvedValue({ id: "cs_new", url: "https://stripe.test/pay" })
  prisma.$queryRaw.mockResolvedValue([{ id: 7 }])
  // 4 x $10 owed, $10 paid → $30 remaining.
  prisma.fundraiserEntry.findUnique.mockResolvedValue({ quantity: 4, unitPrice: "10.00", payments: [{ amount: "10.00" }] })
  prisma.checkoutSession.findMany.mockResolvedValue([])
  getCardFeeConfig.mockResolvedValue({ pct: 1.7, fixedCents: 30 })
})

it("stages a CheckoutSession tagged with the entry, remaining as totalAmount, empty payload", async () => {
  const res = await createFundraiserCheckoutSession(entry, event, "https://app.test")
  expect(res).toEqual({ url: "https://stripe.test/pay" })
  const staged = prisma.checkoutSession.create.mock.calls[0][0].data
  expect(staged).toMatchObject({
    stripeSessionId: "cs_new", eventId: 3, fundraiserEntryId: 7, payload: "", totalAmount: "30.00", surchargeCents: 0,
  })
  const args = sessionsCreate.mock.calls[0][0]
  expect(args.metadata).toEqual({ fundraiserEntryId: "7", eventId: "3" })
  expect(args.payment_intent_data.metadata).toEqual({ fundraiserEntryId: "7", eventId: "3" })
  expect(args.line_items).toHaveLength(1)
  expect(args.line_items[0].price_data.unit_amount).toBe(3000)
  expect(args.success_url).toBe("https://app.test/pay/fundraiser/tok-7?paid=1")
  expect(args.cancel_url).toBe("https://app.test/pay/fundraiser/tok-7")
})

it("row-locks the entry inside a transaction", async () => {
  await createFundraiserCheckoutSession(entry, event, "https://app.test")
  expect(prisma.$transaction).toHaveBeenCalled()
  expect(prisma.$queryRaw).toHaveBeenCalled()
})

it("adds the card fee with the same grossUpTotal computation the reminder email shows", async () => {
  await createFundraiserCheckoutSession(entry, { ...event, passCardFee: true }, "https://app.test")
  const fee = grossUpTotal(3000, 1.7, 30).feeCents
  const staged = prisma.checkoutSession.create.mock.calls[0][0].data
  expect(staged.surchargeCents).toBe(fee)
  const items = sessionsCreate.mock.calls[0][0].line_items
  expect(items).toHaveLength(2)
  expect(items[1].price_data.unit_amount).toBe(fee)
  expect(await fundraiserSurchargeCents(3000, true)).toBe(fee)
  expect(await fundraiserSurchargeCents(3000, false)).toBe(0)
  expect(await fundraiserSurchargeCents(0, true)).toBe(0)
})

it("throws FundraiserNotPayableError when the caller's remaining is 0", async () => {
  await expect(createFundraiserCheckoutSession({ ...entry, remainingCents: 0 }, event, "https://app.test"))
    .rejects.toBeInstanceOf(FundraiserNotPayableError)
  expect(sessionsCreate).not.toHaveBeenCalled()
})

it("throws FundraiserNotPayableError when the locked re-read shows 0 remaining", async () => {
  prisma.fundraiserEntry.findUnique.mockResolvedValue({ quantity: 4, unitPrice: "10.00", payments: [{ amount: "40.00" }] })
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test"))
    .rejects.toBeInstanceOf(FundraiserNotPayableError)
  expect(sessionsCreate).not.toHaveBeenCalled()
})

it("throws FundraiserNotPayableError when the entry vanished", async () => {
  prisma.$queryRaw.mockResolvedValue([])
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test"))
    .rejects.toBeInstanceOf(FundraiserNotPayableError)
})

it("reuses a live open session for the same amount", async () => {
  prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_old", totalAmount: "30.00", surchargeCents: 0 }])
  sessionsRetrieve.mockResolvedValue({ id: "cs_old", status: "open", url: "https://stripe.test/old", expires_at: future() })
  const res = await createFundraiserCheckoutSession(entry, event, "https://app.test")
  expect(res).toEqual({ url: "https://stripe.test/old" })
  expect(sessionsCreate).not.toHaveBeenCalled()
  expect(sessionsExpire).not.toHaveBeenCalled()
})

it("expires an open session staged for a stale amount and creates a fresh one", async () => {
  prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_old", totalAmount: "40.00", surchargeCents: 0 }])
  sessionsRetrieve.mockResolvedValue({ id: "cs_old", status: "open", url: "https://stripe.test/old", expires_at: future() })
  const res = await createFundraiserCheckoutSession(entry, event, "https://app.test")
  expect(sessionsExpire).toHaveBeenCalledWith("cs_old")
  expect(res).toEqual({ url: "https://stripe.test/pay" })
})

it("refuses while a paid session is still awaiting its webhook", async () => {
  prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_paid", totalAmount: "30.00", surchargeCents: 0 }])
  sessionsRetrieve.mockResolvedValue({ id: "cs_paid", status: "complete", url: null, expires_at: future() })
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test"))
    .rejects.toBeInstanceOf(FundraiserNotPayableError)
  expect(sessionsCreate).not.toHaveBeenCalled()
})

it("expires the Stripe session if staging fails after it was created", async () => {
  prisma.checkoutSession.create.mockRejectedValueOnce(new Error("db down"))
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test")).rejects.toThrow("db down")
  expect(sessionsExpire).toHaveBeenCalledWith("cs_new")
})

it("runs the checkout transaction Serializable", async () => {
  await createFundraiserCheckoutSession(entry, event, "https://app.test")
  expect(prisma.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: "Serializable" })
})

it("retries a serialization conflict (P2034), expiring the aborted attempt's session", async () => {
  prisma.checkoutSession.create.mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "P2034" }))
  sessionsCreate
    .mockResolvedValueOnce({ id: "cs_first", url: "https://stripe.test/first" })
    .mockResolvedValueOnce({ id: "cs_second", url: "https://stripe.test/second" })
  const res = await createFundraiserCheckoutSession(entry, event, "https://app.test")
  expect(res).toEqual({ url: "https://stripe.test/second" })
  expect(sessionsExpire).toHaveBeenCalledWith("cs_first")
  expect(sessionsExpire).not.toHaveBeenCalledWith("cs_second")
  expect(prisma.$transaction).toHaveBeenCalledTimes(2)
})

it("surfaces the conflict after 3 Serializable attempts", async () => {
  prisma.checkoutSession.create.mockRejectedValue(Object.assign(new Error("conflict"), { code: "P2034" }))
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test")).rejects.toThrow("conflict")
  expect(prisma.$transaction).toHaveBeenCalledTimes(3)
  expect(sessionsExpire).toHaveBeenCalledTimes(3)
  prisma.checkoutSession.create.mockReset()
})

// startFundraiserCheckout (public server action) guards. Uses the module-level
// mocks above; the action-only collaborators are mocked here.
describe("startFundraiserCheckout", () => {
  const { rateLimit } = require("@/lib/rateLimit")
  const { featureGuard } = require("@/lib/featureFlags")
  const { startFundraiserCheckout } = require("@/lib/actions/eventCheckout")
  const owing = {
    id: 7, publicToken: "tok-7", quantity: 4, unitPrice: "10.00", payments: [{ amount: "10.00" }],
    fundraiser: { event: { id: 3, slug: "feast", title: "Feast", passCardFee: false, onlinePaymentEnabled: true } },
  }

  beforeEach(() => {
    process.env.AUTH_URL = "https://app.test"
    rateLimit.mockReturnValue(true)
    featureGuard.mockResolvedValue(null)
  })

  it("throttles per client under the fundraiser-checkout key", async () => {
    rateLimit.mockReturnValue(false)
    expect(await startFundraiserCheckout("tok-7")).toMatchObject({ ok: false, status: 429 })
    expect(rateLimit).toHaveBeenCalledWith("fundraiser-checkout:1.2.3.4", 10, 60_000)
  })

  it("unknown or malformed token → 404", async () => {
    prisma.fundraiserEntry.findUnique.mockResolvedValue(null)
    expect(await startFundraiserCheckout("nope")).toMatchObject({ ok: false, status: 404 })
    expect(await startFundraiserCheckout("bad/token")).toMatchObject({ ok: false, status: 404 })
  })

  it("nothing remaining → 400, no Stripe session", async () => {
    prisma.fundraiserEntry.findUnique.mockResolvedValue({ ...owing, payments: [{ amount: "40.00" }] })
    expect(await startFundraiserCheckout("tok-7")).toMatchObject({ ok: false, status: 400 })
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("event online payment off → 400", async () => {
    prisma.fundraiserEntry.findUnique.mockResolvedValue({ ...owing, fundraiser: { event: { ...owing.fundraiser.event, onlinePaymentEnabled: false } } })
    expect(await startFundraiserCheckout("tok-7")).toMatchObject({ ok: false, status: 400 })
  })

  it("owing entry → Stripe URL", async () => {
    prisma.fundraiserEntry.findUnique.mockResolvedValueOnce(owing).mockResolvedValue(owing)
    expect(await startFundraiserCheckout("tok-7")).toEqual({ ok: true, url: "https://stripe.test/pay" })
  })
})
