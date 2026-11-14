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
  const checkoutSession = { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() }
  const fundraiserEntry = { findUnique: jest.fn() }
  const tx = { checkoutSession, fundraiserEntry, $queryRaw: jest.fn() }
  return { prisma: { ...tx, $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } }
})
jest.mock("@/lib/cardFeeSettings", () => ({ getCardFeeConfig: jest.fn() }))

import {
  createFundraiserCheckoutSession,
  expireOpenFundraiserCheckouts,
  fundraiserSurchargeCents,
  FundraiserNotPayableError,
  FundraiserAmountOutOfRangeError,
  FundraiserCheckoutBusyError,
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
  prisma.checkoutSession.updateMany.mockResolvedValue({ count: 1 })
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
  // Its staging row is closed too, so deleteEntry is not blocked until the sweep.
  expect(prisma.checkoutSession.updateMany).toHaveBeenCalledWith({
    where: { stripeSessionId: { in: ["cs_old"] }, status: "OPEN" },
    data: { status: "EXPIRED", payload: "" },
  })
})

it("retrieves prior sessions before taking the entry lock (no Stripe retrieve while locked)", async () => {
  prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_old", totalAmount: "30.00", surchargeCents: 0 }])
  const order: string[] = []
  sessionsRetrieve.mockImplementation(async () => {
    order.push("retrieve")
    return { id: "cs_old", status: "open", url: "https://stripe.test/old", expires_at: future() }
  })
  prisma.$queryRaw.mockImplementation(async () => {
    order.push("lock")
    return [{ id: 7 }]
  })
  expect(await createFundraiserCheckoutSession(entry, event, "https://app.test")).toEqual({ url: "https://stripe.test/old" })
  expect(order).toEqual(["retrieve", "lock"])
})

it("a prefetched 'open' session that Stripe refuses to expire is re-checked: already expired = dead, checkout proceeds", async () => {
  prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_old", totalAmount: "40.00", surchargeCents: 0 }])
  sessionsRetrieve
    .mockResolvedValueOnce({ id: "cs_old", status: "open", url: "https://stripe.test/old", expires_at: future() })
    .mockResolvedValueOnce({ id: "cs_old", status: "expired", url: null, expires_at: future() })
  sessionsExpire.mockRejectedValueOnce(Object.assign(new Error("not open"), { code: "checkout_session_not_open" }))
  expect(await createFundraiserCheckoutSession(entry, event, "https://app.test")).toEqual({ url: "https://stripe.test/pay" })
  expect(prisma.checkoutSession.updateMany).toHaveBeenCalledWith({
    where: { stripeSessionId: { in: ["cs_old"] }, status: "OPEN" },
    data: { status: "EXPIRED", payload: "" },
  })
})

it("a prefetched 'open' session paid before the lock blocks a new session", async () => {
  prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_old", totalAmount: "40.00", surchargeCents: 0 }])
  sessionsRetrieve
    .mockResolvedValueOnce({ id: "cs_old", status: "open", url: "https://stripe.test/old", expires_at: future() })
    .mockResolvedValueOnce({ id: "cs_old", status: "complete", url: null, expires_at: future() })
  sessionsExpire.mockRejectedValueOnce(Object.assign(new Error("not open"), { code: "checkout_session_not_open" }))
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test")).rejects.toBeInstanceOf(FundraiserNotPayableError)
  expect(sessionsCreate).not.toHaveBeenCalled()
})

it("an expire refusal that cannot be re-checked fails the checkout (never a second payable session)", async () => {
  prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_old", totalAmount: "40.00", surchargeCents: 0 }])
  sessionsRetrieve
    .mockResolvedValueOnce({ id: "cs_old", status: "open", url: "https://stripe.test/old", expires_at: future() })
    .mockRejectedValueOnce(new Error("stripe down"))
  sessionsExpire.mockRejectedValueOnce(new Error("stripe down"))
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test")).rejects.toThrow("stripe down")
  expect(sessionsCreate).not.toHaveBeenCalled()
})

it("marks a prior row EXPIRED when Stripe already expired its session", async () => {
  prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_lapsed", totalAmount: "30.00", surchargeCents: 0 }])
  sessionsRetrieve.mockResolvedValue({ id: "cs_lapsed", status: "expired", url: null, expires_at: future() })
  await createFundraiserCheckoutSession(entry, event, "https://app.test")
  expect(sessionsExpire).not.toHaveBeenCalled()
  expect(prisma.checkoutSession.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { stripeSessionId: { in: ["cs_lapsed"] }, status: "OPEN" } }),
  )
})

it("a prior session Stripe reports missing does not block checkout; its row is marked EXPIRED", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
  prisma.checkoutSession.findMany.mockResolvedValue([
    { stripeSessionId: "cs_gone", totalAmount: "30.00", surchargeCents: 0 },
    { stripeSessionId: "cs_old", totalAmount: "40.00", surchargeCents: 0 },
  ])
  sessionsRetrieve.mockImplementation(async (id: string) => {
    if (id === "cs_gone") throw Object.assign(new Error("No such checkout.session"), { code: "resource_missing" })
    return { id, status: "open", url: "https://stripe.test/old", expires_at: future() }
  })
  const res = await createFundraiserCheckoutSession(entry, event, "https://app.test")
  expect(res).toEqual({ url: "https://stripe.test/pay" })
  expect(sessionsExpire).toHaveBeenCalledWith("cs_old")
  expect(prisma.checkoutSession.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { stripeSessionId: { in: ["cs_gone", "cs_old"] }, status: "OPEN" } }),
  )
})

it("an auth failure on a prior session (e.g. rotated key) is unknown state: busy error, nothing expired", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
  prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_denied", totalAmount: "30.00", surchargeCents: 0 }])
  sessionsRetrieve.mockRejectedValue(Object.assign(new Error("Invalid API Key"), { type: "StripeAuthenticationError", statusCode: 401 }))
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test")).rejects.toBeInstanceOf(FundraiserCheckoutBusyError)
  expect(sessionsCreate).not.toHaveBeenCalled()
  expect(prisma.checkoutSession.updateMany).not.toHaveBeenCalled()
})

it("a 429 on a prior session is transient: busy error", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
  prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_rl", totalAmount: "30.00", surchargeCents: 0 }])
  sessionsRetrieve.mockRejectedValue(Object.assign(new Error("rate limit"), { type: "StripeRateLimitError", statusCode: 429 }))
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test")).rejects.toBeInstanceOf(FundraiserCheckoutBusyError)
  expect(sessionsCreate).not.toHaveBeenCalled()
})

it("a transient retrieve failure opens no new session: retryable busy error, nothing expired", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
  prisma.checkoutSession.findMany.mockResolvedValue([
    { stripeSessionId: "cs_flaky", totalAmount: "30.00", surchargeCents: 0 },
    { stripeSessionId: "cs_old", totalAmount: "40.00", surchargeCents: 0 },
  ])
  sessionsRetrieve.mockImplementation(async (id: string) => {
    if (id === "cs_flaky") throw Object.assign(new Error("timeout"), { statusCode: 503 })
    return { id, status: "open", url: "https://stripe.test/old", expires_at: future() }
  })
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test"))
    .rejects.toBeInstanceOf(FundraiserCheckoutBusyError)
  expect(sessionsCreate).not.toHaveBeenCalled()
  expect(sessionsExpire).not.toHaveBeenCalled()
  expect(prisma.checkoutSession.updateMany).not.toHaveBeenCalled()
})

it("a transient prefetch failure is busy (retryable) with no second Stripe call under the lock", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
  prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_flaky", totalAmount: "30.00", surchargeCents: 0 }])
  sessionsRetrieve.mockRejectedValue(Object.assign(new Error("timeout"), { statusCode: 503 }))
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test")).rejects.toBeInstanceOf(FundraiserCheckoutBusyError)
  expect(sessionsRetrieve).toHaveBeenCalledTimes(1)
  expect(sessionsCreate).not.toHaveBeenCalled()
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

it("does not retry a conflict when the aborted attempt's session could not be expired", async () => {
  prisma.checkoutSession.create.mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "P2034" }))
  sessionsCreate.mockResolvedValueOnce({ id: "cs_orphan", url: "https://stripe.test/orphan" })
  sessionsExpire.mockRejectedValueOnce(new Error("stripe down"))
  // A retry would open a second payable session next to the still-live orphan.
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test")).rejects.toThrow("conflict")
  expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  expect(sessionsCreate).toHaveBeenCalledTimes(1)
})

it("rejects a balance below Stripe's minimum charge with a handled error", async () => {
  // 4 x $10 owed, $39.70 paid → $0.30 remaining.
  prisma.fundraiserEntry.findUnique.mockResolvedValue({ quantity: 4, unitPrice: "10.00", payments: [{ amount: "39.70" }] })
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test"))
    .rejects.toBeInstanceOf(FundraiserAmountOutOfRangeError)
  expect(sessionsCreate).not.toHaveBeenCalled()
})

it("rejects a balance plus card fee above Stripe's maximum charge with a handled error", async () => {
  prisma.fundraiserEntry.findUnique.mockResolvedValue({ quantity: 1, unitPrice: "999999.00", payments: [] })
  await expect(createFundraiserCheckoutSession(entry, { ...event, passCardFee: true }, "https://app.test"))
    .rejects.toBeInstanceOf(FundraiserAmountOutOfRangeError)
  expect(sessionsCreate).not.toHaveBeenCalled()
})

it("surfaces the conflict after 3 Serializable attempts", async () => {
  prisma.checkoutSession.create.mockRejectedValue(Object.assign(new Error("conflict"), { code: "P2034" }))
  await expect(createFundraiserCheckoutSession(entry, event, "https://app.test")).rejects.toThrow("conflict")
  expect(prisma.$transaction).toHaveBeenCalledTimes(3)
  expect(sessionsExpire).toHaveBeenCalledTimes(3)
  prisma.checkoutSession.create.mockReset()
})

describe("expireOpenFundraiserCheckouts", () => {
  it("expires each open session in Stripe and marks its rows EXPIRED", async () => {
    prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_a" }, { stripeSessionId: "cs_b" }])
    sessionsExpire.mockResolvedValue({})
    prisma.checkoutSession.updateMany.mockResolvedValue({ count: 2 })
    expect(await expireOpenFundraiserCheckouts(7)).toBe(2)
    expect(sessionsExpire).toHaveBeenCalledWith("cs_a")
    expect(sessionsExpire).toHaveBeenCalledWith("cs_b")
    expect(prisma.checkoutSession.updateMany).toHaveBeenCalledWith({
      where: { stripeSessionId: { in: ["cs_a", "cs_b"] }, status: "OPEN" },
      data: { status: "EXPIRED", payload: "" },
    })
  })

  it("leaves a completed session's row OPEN for its webhook and never throws on Stripe errors", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {})
    prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_paid" }, { stripeSessionId: "cs_lapsed" }])
    sessionsExpire.mockRejectedValue(new Error("not open"))
    sessionsRetrieve.mockImplementation(async (id: string) => ({ id, status: id === "cs_paid" ? "complete" : "expired" }))
    prisma.checkoutSession.updateMany.mockResolvedValue({ count: 1 })
    expect(await expireOpenFundraiserCheckouts(7)).toBe(1)
    expect(prisma.checkoutSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeSessionId: { in: ["cs_lapsed"] }, status: "OPEN" } }),
    )
  })

  it("does nothing (no Stripe call) when no session is open", async () => {
    expect(await expireOpenFundraiserCheckouts(7)).toBe(0)
    expect(sessionsExpire).not.toHaveBeenCalled()
  })

  it("swallows a DB failure", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {})
    prisma.checkoutSession.findMany.mockRejectedValue(new Error("db down"))
    expect(await expireOpenFundraiserCheckouts(7)).toBe(0)
  })
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

  it("an AUTH_URL with a path still gives origin-only Stripe return URLs", async () => {
    process.env.AUTH_URL = "https://app.test/api/auth"
    prisma.fundraiserEntry.findUnique.mockResolvedValueOnce(owing).mockResolvedValue(owing)
    expect(await startFundraiserCheckout("tok-7")).toMatchObject({ ok: true })
    expect(sessionsCreate.mock.calls[0][0].cancel_url).toBe("https://app.test/pay/fundraiser/tok-7")
  })

  it("a malformed AUTH_URL is a handled configuration error", async () => {
    process.env.AUTH_URL = "not a url"
    prisma.fundraiserEntry.findUnique.mockResolvedValue(owing)
    expect(await startFundraiserCheckout("tok-7")).toMatchObject({ ok: false, status: 500 })
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("an amount outside Stripe's limits → 400, not an uncaught 500", async () => {
    const tiny = { ...owing, payments: [{ amount: "39.70" }] }
    prisma.fundraiserEntry.findUnique.mockResolvedValue(tiny)
    expect(await startFundraiserCheckout("tok-7")).toMatchObject({ ok: false, status: 400 })
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("a prior session Stripe could not be checked → 503 retry message, no new session", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {})
    prisma.fundraiserEntry.findUnique.mockResolvedValue(owing)
    prisma.checkoutSession.findMany.mockResolvedValue([{ stripeSessionId: "cs_flaky", totalAmount: "30.00", surchargeCents: 0 }])
    sessionsRetrieve.mockRejectedValue(new Error("network"))
    expect(await startFundraiserCheckout("tok-7")).toEqual({ ok: false, status: 503, error: "Payment is busy, try again in a moment" })
    expect(sessionsCreate).not.toHaveBeenCalled()
  })
})
