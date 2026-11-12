/** @jest-environment node */
// Fundraiser card payments landing via the Stripe webhook. Money-critical:
// redeliveries must never double-credit, a mismatched charge must never be
// recorded, and the card fee must never count toward the family's balance.
jest.mock("@/lib/stripe", () => {
  const webhooks = { constructEvent: jest.fn() }
  const checkout = { sessions: { list: jest.fn() } }
  return { getStripe: () => ({ webhooks, checkout }) }
})
jest.mock("@/lib/eventRegistrationPersist", () => ({ persistRegistration: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const p = {
    checkoutSession: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    fundraiserEntry: { findUnique: jest.fn() },
    fundraiserPayment: { create: jest.fn() },
    event: { findUnique: jest.fn() },
    registration: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  }
  p.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(p))
  return { prisma: p }
})
jest.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => s }))
jest.mock("@/lib/notifications", () => ({ notifyStripeAlert: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))

import { completeFundraiserPayment } from "@/lib/fundraiserWebhook"
import { handleStripeWebhook } from "@/lib/stripeCheckout"
import { entryTotals } from "@/lib/fundraiserMath"
const { prisma } = require("@/lib/prisma")
const { getStripe } = require("@/lib/stripe")
const { notifyStripeAlert } = require("@/lib/notifications")
const { logAudit } = require("@/lib/audit")
const { persistRegistration } = require("@/lib/eventRegistrationPersist")

type Staging = { id: number; status: string; fundraiserEntryId: number | null; totalAmount: string; surchargeCents: number }
const staging = (over: Partial<Staging> = {}): Staging =>
  ({ id: 11, status: "OPEN", fundraiserEntryId: 7, totalAmount: "30.00", surchargeCents: 0, ...over })
const session = (over: Record<string, unknown> = {}) =>
  ({ id: "cs_f", payment_intent: "pi_f", amount_total: 3000, metadata: { fundraiserEntryId: "7", eventId: "3" }, ...over }) as never

// Stateful staging row so a redelivery sees what the first delivery wrote.
let rowStatus = "OPEN"
const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" })

beforeEach(() => {
  jest.clearAllMocks()
  rowStatus = "OPEN"
  prisma.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(prisma))
  prisma.checkoutSession.updateMany.mockImplementation(({ where, data }: { where: { status: string | { in: string[] } }; data: { status?: string } }) => {
    const matches = typeof where.status === "string" ? where.status === rowStatus : where.status.in.includes(rowStatus)
    if (!matches) return Promise.resolve({ count: 0 })
    if (data.status) rowStatus = data.status
    return Promise.resolve({ count: 1 })
  })
  prisma.$queryRaw.mockResolvedValue([{ id: 7 }])
  prisma.fundraiserEntry.findUnique.mockResolvedValue({ quantity: 4, unitPrice: "10.00", payments: [{ amount: "10.00" }] })
  prisma.fundraiserPayment.create.mockResolvedValue({ id: 99 })
})

it("records one ONLINE payment for the base amount with the PI as ref and a system audit", async () => {
  expect(await completeFundraiserPayment(session(), staging())).toEqual({ status: 200 })
  expect(prisma.fundraiserPayment.create).toHaveBeenCalledTimes(1)
  const data = prisma.fundraiserPayment.create.mock.calls[0][0].data
  expect(data).toMatchObject({ entryId: 7, method: "ONLINE", amount: "30.00", stripePaymentRef: "pi_f", recordedById: null })
  expect(rowStatus).toBe("COMPLETED")
  expect(logAudit).toHaveBeenCalledWith(null, "FUNDRAISER_PAYMENT_ONLINE", "FundraiserPayment", 99, expect.objectContaining({ entryId: 7 }))
  expect(notifyStripeAlert).not.toHaveBeenCalled()
})

it("webhook delivered twice with the same payment intent → exactly one payment", async () => {
  await completeFundraiserPayment(session(), staging())
  // Redelivery: the row now reads COMPLETED.
  expect(await completeFundraiserPayment(session(), staging({ status: rowStatus }))).toEqual({ status: 200 })
  expect(prisma.fundraiserPayment.create).toHaveBeenCalledTimes(1)
  expect(notifyStripeAlert).not.toHaveBeenCalled()
})

it("claim loser (both read OPEN, other delivery claimed first) no-ops", async () => {
  rowStatus = "COMPLETED" // the twin's claim landed between our read and our claim
  expect(await completeFundraiserPayment(session(), staging())).toEqual({ status: 200 })
  expect(prisma.fundraiserPayment.create).not.toHaveBeenCalled()
})

it("unique violation on the payment ref is a benign redelivery → 200, no alert", async () => {
  prisma.fundraiserPayment.create.mockRejectedValue(p2002())
  expect(await completeFundraiserPayment(session(), staging())).toEqual({ status: 200 })
  expect(notifyStripeAlert).not.toHaveBeenCalled()
  expect(logAudit).not.toHaveBeenCalled()
})

it("amount mismatch → alert, zero payments, row terminal", async () => {
  expect(await completeFundraiserPayment(session({ amount_total: 2500 }), staging())).toEqual({ status: 200 })
  expect(prisma.fundraiserPayment.create).not.toHaveBeenCalled()
  expect(notifyStripeAlert).toHaveBeenCalledWith(expect.stringMatching(/amount mismatch/), expect.any(String))
  expect(rowStatus).toBe("UNFULFILLED")
})

it("surcharge is excluded from the recorded amount", async () => {
  const res = await completeFundraiserPayment(session({ amount_total: 3083 }), staging({ surchargeCents: 83 }))
  expect(res).toEqual({ status: 200 })
  expect(prisma.fundraiserPayment.create.mock.calls[0][0].data.amount).toBe("30.00")
})

it("card lands after cash cleared the balance → payment recorded, entry OVERPAID, ops alerted", async () => {
  const entry = { quantity: 4, unitPrice: "10.00", payments: [{ amount: "40.00" }] }
  prisma.fundraiserEntry.findUnique.mockResolvedValue(entry)
  expect(await completeFundraiserPayment(session(), staging())).toEqual({ status: 200 })
  expect(prisma.fundraiserPayment.create).toHaveBeenCalledTimes(1)
  const recorded = prisma.fundraiserPayment.create.mock.calls[0][0].data.amount
  expect(entryTotals(entry, [...entry.payments, { amount: recorded }]).status).toBe("OVERPAID")
  expect(notifyStripeAlert).toHaveBeenCalledWith(expect.stringMatching(/overpa/i), expect.any(String))
})

it("entry deleted (fundraiserEntryId nulled) → alert, no payment, no crash", async () => {
  expect(await completeFundraiserPayment(session(), staging({ fundraiserEntryId: null }))).toEqual({ status: 200 })
  expect(prisma.fundraiserPayment.create).not.toHaveBeenCalled()
  expect(notifyStripeAlert).toHaveBeenCalled()
  expect(rowStatus).toBe("UNFULFILLED")
})

it("entry row gone at lock time → alert, no payment", async () => {
  prisma.$queryRaw.mockResolvedValue([])
  expect(await completeFundraiserPayment(session(), staging())).toEqual({ status: 200 })
  expect(prisma.fundraiserPayment.create).not.toHaveBeenCalled()
  expect(notifyStripeAlert).toHaveBeenCalled()
  expect(rowStatus).toBe("UNFULFILLED")
})

it("paid after the sweep expired the row → payment still recorded, row COMPLETED, no alert", async () => {
  rowStatus = "EXPIRED"
  jest.spyOn(console, "warn").mockImplementation(() => {})
  expect(await completeFundraiserPayment(session(), staging({ status: "EXPIRED" }))).toEqual({ status: 200 })
  expect(prisma.fundraiserPayment.create).toHaveBeenCalledTimes(1)
  expect(prisma.fundraiserPayment.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ entryId: 7, amount: "30.00", method: "ONLINE", stripePaymentRef: "pi_f" }) }),
  )
  expect(rowStatus).toBe("COMPLETED")
  expect(notifyStripeAlert).not.toHaveBeenCalled()
})

it("late payment on an EXPIRED row redelivered → exactly one payment", async () => {
  rowStatus = "EXPIRED"
  jest.spyOn(console, "warn").mockImplementation(() => {})
  await completeFundraiserPayment(session(), staging({ status: "EXPIRED" }))
  await completeFundraiserPayment(session(), staging({ status: "EXPIRED" }))
  expect(prisma.fundraiserPayment.create).toHaveBeenCalledTimes(1)
})

it("unexpected DB error → 500 so Stripe retries, row left OPEN", async () => {
  prisma.fundraiserPayment.create.mockRejectedValue(new Error("db down"))
  // Real tx would roll the claim back; emulate that.
  prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => {
    const before = rowStatus
    try { return await fn(prisma) } catch (e) { rowStatus = before; throw e }
  })
  jest.spyOn(console, "error").mockImplementation(() => {})
  expect(await completeFundraiserPayment(session(), staging())).toEqual({ status: 500 })
  expect(rowStatus).toBe("OPEN")
  expect(notifyStripeAlert).toHaveBeenCalled()
})

it("runs the claim + insert transaction Serializable (SSI must see it vs staff payments)", async () => {
  await completeFundraiserPayment(session(), staging())
  expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" })
})

it("serialization conflict (P2034) → 500 so Stripe retries, row left OPEN, no ops alert", async () => {
  const p2034 = Object.assign(new Error("could not serialize access"), { code: "P2034" })
  prisma.fundraiserPayment.create.mockRejectedValue(p2034)
  prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => {
    const before = rowStatus
    try { return await fn(prisma) } catch (e) { rowStatus = before; throw e }
  })
  jest.spyOn(console, "warn").mockImplementation(() => {})
  expect(await completeFundraiserPayment(session(), staging())).toEqual({ status: 500 })
  expect(rowStatus).toBe("OPEN")
  expect(notifyStripeAlert).not.toHaveBeenCalled()
  expect(logAudit).not.toHaveBeenCalled()
  // Expiry pushed out so the hourly sweep cannot expire the row before the retry.
  expect(prisma.checkoutSession.updateMany).toHaveBeenLastCalledWith(
    expect.objectContaining({ where: { id: 11, status: "OPEN" }, data: { expiresAt: expect.any(Date) } }),
  )
})

describe("routing through handleStripeWebhook", () => {
  beforeEach(() => { process.env.STRIPE_WEBHOOK_SECRET = "whsec_x" })

  it("sends a fundraiser-tagged staging row to the fundraiser branch, not ticket persistence", async () => {
    getStripe().webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { ...(session() as object), payment_status: "paid" } },
    })
    prisma.checkoutSession.findUnique.mockResolvedValue({ ...staging(), registrationId: null, payload: "", eventId: 3, publicToken: null })
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
    expect(prisma.fundraiserPayment.create).toHaveBeenCalledTimes(1)
    expect(persistRegistration).not.toHaveBeenCalled()
  })

  it("routes by session metadata when the entry FK was nulled by a delete", async () => {
    getStripe().webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { ...(session() as object), payment_status: "paid" } },
    })
    prisma.checkoutSession.findUnique.mockResolvedValue({ ...staging({ fundraiserEntryId: null }), registrationId: null, payload: "", eventId: 3, publicToken: null })
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
    expect(persistRegistration).not.toHaveBeenCalled()
    expect(prisma.fundraiserPayment.create).not.toHaveBeenCalled()
    expect(notifyStripeAlert).toHaveBeenCalled()
  })

  it("a COMPLETED fundraiser redelivery does not raise the ticket missing-token alert", async () => {
    getStripe().webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { ...(session() as object), payment_status: "paid" } },
    })
    prisma.checkoutSession.findUnique.mockResolvedValue({ ...staging({ status: "COMPLETED" }), registrationId: null, payload: "", eventId: 3, publicToken: null })
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
    expect(notifyStripeAlert).not.toHaveBeenCalled()
  })
})

describe("refund/dispute of a fundraiser card payment", () => {
  beforeEach(() => { process.env.STRIPE_WEBHOOK_SECRET = "whsec_x" })

  it("alerts ops and acknowledges (no 500 retry loop on a COMPLETED fundraiser row)", async () => {
    getStripe().webhooks.constructEvent.mockReturnValue({
      type: "charge.refunded",
      data: { object: { id: "ch_1", payment_intent: "pi_f", amount: 3000, amount_refunded: 3000 } },
    })
    prisma.registration.findFirst.mockResolvedValue(null)
    getStripe().checkout.sessions.list.mockResolvedValue({ data: [{ id: "cs_f", metadata: { fundraiserEntryId: "7" } }] })
    prisma.checkoutSession.findUnique.mockResolvedValue({ status: "COMPLETED", publicToken: null, fundraiserEntryId: 7 })
    jest.spyOn(console, "error").mockImplementation(() => {})
    expect(await handleStripeWebhook("{}", "sig")).toEqual({ status: 200 })
    expect(notifyStripeAlert).toHaveBeenCalledWith(expect.stringMatching(/fundraiser/), expect.any(String))
    // No in-app adjustment exists: the alert must say so and point ops at the DB row.
    const body = notifyStripeAlert.mock.calls[0][1] as string
    expect(body).toContain("stays counted as paid")
    expect(body).toContain("directly in the database")
    expect(body).toContain("fundraiser entry 7")
    expect(body).toContain("stripePaymentRef = pi_f")
    expect(body).not.toMatch(/adjust the fundraiser manually/)
    expect(prisma.registration.update).not.toHaveBeenCalled()
  })
})
