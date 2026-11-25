/** @jest-environment node */
jest.mock("@/lib/featureFlags")
import { publishEvent, updateEvent } from "@/lib/actions/event"
import { PAID_EVENT_NEEDS_PAYMENT_ERROR, PAID_EVENT_STRIPE_MISSING_ERROR } from "@/lib/eventPaymentRule"

jest.mock("@/auth", () => ({ auth: jest.fn(async () => ({ user: { id: "1", role: "ADMIN" } })) }))
jest.mock("@/lib/websiteSync", () => ({
  syncEventToWebsite: jest.fn(async () => {}),
  syncEventDeletion: jest.fn(async () => {}),
  resyncAllEvents: jest.fn(async () => {}),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT") }) }))
const mStripe = jest.fn(() => false)
jest.mock("@/lib/stripe", () => ({ stripeConfigured: () => mStripe() }))

const findUnique = jest.fn()
const updateMany = jest.fn(async () => ({ count: 1 }))
const transaction = jest.fn(async () => { throw new Error("NEXT_REDIRECT") })
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      updateMany: (...a: unknown[]) => updateMany(...(a as [])),
    },
    $transaction: (...a: unknown[]) => transaction(...(a as [])),
  },
}))

const draft = (over: Record<string, unknown> = {}) => ({
  id: 1, slug: "feast", isPublished: false,
  bankBsb: null, bankAccount: null, onlinePaymentEnabled: false,
  tieredPricingEnabled: false, familyPricingTiers: null,
  ticketTypes: [{ price: "25.00" }],
  updatedAt: new Date(1000),
  ...over,
})

beforeEach(() => { jest.clearAllMocks(); mStripe.mockReturnValue(false) })

describe("publishEvent paid-event rule", () => {
  it("blocks publishing a paid event with card off and blank bank", async () => {
    findUnique.mockResolvedValue(draft())
    expect(await publishEvent(1, true)).toEqual({ error: PAID_EVENT_NEEDS_PAYMENT_ERROR })
    expect(updateMany).not.toHaveBeenCalled()
  })
  it("blocks when card is on but Stripe is not configured", async () => {
    findUnique.mockResolvedValue(draft({ onlinePaymentEnabled: true }))
    expect(await publishEvent(1, true)).toEqual({ error: PAID_EVENT_STRIPE_MISSING_ERROR })
    expect(PAID_EVENT_STRIPE_MISSING_ERROR).toBe("Card payments aren't set up on this server. Add the BSB and account number.")
    expect(updateMany).not.toHaveBeenCalled()
  })
  it("allows publishing with bank details", async () => {
    findUnique.mockResolvedValue(draft({ bankBsb: "012-345", bankAccount: "123" }))
    expect(await publishEvent(1, true)).toBeUndefined()
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1, slug: { not: null }, updatedAt: new Date(1000) },
    }))
  })
  it("reports a changed event when the guarded write matches 0 rows", async () => {
    findUnique.mockResolvedValue(draft({ bankBsb: "012-345", bankAccount: "123" }))
    updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await publishEvent(1, true)).toEqual({ error: "Event changed while publishing — reload and try again" })
  })
  it("allows publishing with card on and Stripe configured", async () => {
    mStripe.mockReturnValue(true)
    findUnique.mockResolvedValue(draft({ onlinePaymentEnabled: true }))
    expect(await publishEvent(1, true)).toBeUndefined()
  })
  it("allows publishing a free event", async () => {
    findUnique.mockResolvedValue(draft({ ticketTypes: [{ price: "0.00" }] }))
    expect(await publishEvent(1, true)).toBeUndefined()
  })
  it("blocks tiered-price paid event; ignores tiers when tiering off", async () => {
    findUnique.mockResolvedValue(draft({ ticketTypes: [], tieredPricingEnabled: true, familyPricingTiers: [20, 30] }))
    expect(await publishEvent(1, true)).toEqual({ error: PAID_EVENT_NEEDS_PAYMENT_ERROR })
    findUnique.mockResolvedValue(draft({ ticketTypes: [], tieredPricingEnabled: false, familyPricingTiers: [20, 30] }))
    expect(await publishEvent(1, true)).toBeUndefined()
  })
  it("unpublishing is never blocked", async () => {
    findUnique.mockResolvedValue(draft({ isPublished: true }))
    expect(await publishEvent(1, false)).toBeUndefined()
  })
})

describe("updateEvent paid-event rule", () => {
  const fd = (extra: Record<string, string> = {}) => {
    const f = new FormData()
    const fields = { title: "Feast", slug: "feast", kind: "one_off", date: "2026-08-01T10:00", category: "worship", "ticketType.0.id": "5", "ticketType.0.name": "Adult", "ticketType.0.price": "25.00", "ticketType.0.capacity": "", ...extra }
    for (const [k, v] of Object.entries(fields)) f.set(k, v)
    return f
  }
  const pub = (over: Record<string, unknown> = {}) => ({
    id: 1, slug: "feast", isPublished: true,
    bankBsb: null, bankAccount: null, onlinePaymentEnabled: false,
    tieredPricingEnabled: false, familyPricingTiers: null,
    ticketTypes: [{ id: 5, price: "25.00" }],
    ...over,
  })
  it("rejects a save that removes bank details from a compliant published paid event", async () => {
    findUnique.mockResolvedValue(pub({ bankBsb: "012-345", bankAccount: "123" }))
    expect(await updateEvent(1, undefined, fd())).toEqual({ error: PAID_EVENT_NEEDS_PAYMENT_ERROR })
    expect(transaction).not.toHaveBeenCalled()
  })
  it("allows an unrelated edit on a legacy non-compliant published event", async () => {
    findUnique.mockResolvedValue(pub())
    await expect(updateEvent(1, undefined, fd({ title: "Feast (fixed typo)" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(transaction).toHaveBeenCalled()
  })
  it("rejects a price change on a legacy non-compliant published event", async () => {
    findUnique.mockResolvedValue(pub())
    expect(await updateEvent(1, undefined, fd({ "ticketType.0.price": "30.00" }))).toEqual({ error: PAID_EVENT_NEEDS_PAYMENT_ERROR })
    expect(transaction).not.toHaveBeenCalled()
  })
  it("rejects swapping prices between tickets (equal sorted lists) on a legacy event", async () => {
    findUnique.mockResolvedValue(pub({ ticketTypes: [{ id: 5, price: "25.00" }, { id: 6, price: "10.00" }] }))
    const swapped = fd({
      "ticketType.0.price": "10.00",
      "ticketType.1.id": "6", "ticketType.1.name": "Child", "ticketType.1.price": "25.00", "ticketType.1.capacity": "",
    })
    expect(await updateEvent(1, undefined, swapped)).toEqual({ error: PAID_EVENT_NEEDS_PAYMENT_ERROR })
    expect(transaction).not.toHaveBeenCalled()
  })
  it("allows reordering tickets with unchanged prices on a legacy event", async () => {
    findUnique.mockResolvedValue(pub({ ticketTypes: [{ id: 5, price: "25.00" }, { id: 6, price: "10.00" }] }))
    const reordered = fd({
      "ticketType.0.id": "6", "ticketType.0.name": "Child", "ticketType.0.price": "10.00",
      "ticketType.1.id": "5", "ticketType.1.name": "Adult", "ticketType.1.price": "25.00", "ticketType.1.capacity": "",
    })
    await expect(updateEvent(1, undefined, reordered)).rejects.toThrow("NEXT_REDIRECT")
    expect(transaction).toHaveBeenCalled()
  })
  it("rejects turning card off on a card-only published event", async () => {
    mStripe.mockReturnValue(true)
    findUnique.mockResolvedValue(pub({ onlinePaymentEnabled: true }))
    expect(await updateEvent(1, undefined, fd())).toEqual({ error: PAID_EVENT_NEEDS_PAYMENT_ERROR })
  })
  it("allows saving a draft incomplete", async () => {
    findUnique.mockResolvedValue({ id: 1, slug: "feast", isPublished: false })
    await expect(updateEvent(1, undefined, fd())).rejects.toThrow("NEXT_REDIRECT")
    expect(transaction).toHaveBeenCalled()
  })
  it("allows saving a published paid event with bank details", async () => {
    findUnique.mockResolvedValue(pub())
    await expect(updateEvent(1, undefined, fd({ bankBsb: "012-345", bankAccount: "123" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(transaction).toHaveBeenCalled()
  })
})
