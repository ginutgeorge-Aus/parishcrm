/** @jest-environment node */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
    registration: { findFirst: jest.fn(), findUnique: jest.fn() },
    checkoutSession: { findUnique: jest.fn() },
  },
}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NOT_FOUND")
  }),
}))
jest.mock("next/headers", () => ({
  headers: jest.fn(async () => ({ get: () => "1.2.3.4" })),
}))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/stripe", () => ({ stripeConfigured: jest.fn(() => false) }))
// getChurchSettings uses unstable_cache, which throws "incrementalCache missing"
// outside a Next request context — mock it so the page renders under jest.
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn().mockResolvedValue({
    name: "Example Community Church",
    address: "",
    abn: "",
    email: "church@example.org",
    website: "",
  }),
}))

import { renderToStaticMarkup } from "react-dom/server"
import SuccessPage from "@/app/(public)/e/[slug]/success/page"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rateLimit"
import { stripeConfigured } from "@/lib/stripe"

const mockEventFindUnique = prisma.event.findUnique as jest.Mock
const mockRegFindFirst = prisma.registration.findFirst as jest.Mock
const mockRegFindUnique = prisma.registration.findUnique as jest.Mock
const mockCheckoutSessionFindUnique = prisma.checkoutSession.findUnique as jest.Mock
const mockRateLimit = rateLimit as jest.Mock
const mockStripeConfigured = stripeConfigured as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockRateLimit.mockReturnValue(true)
  mockStripeConfigured.mockReturnValue(false)
})

function render(slug: string, ref: string) {
  return SuccessPage({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve({ ref }),
  })
}

function renderWithToken(slug: string, token: string) {
  return SuccessPage({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve({ token }),
  })
}

it("404s on an unpublished event — bank details must not leak", async () => {
  mockEventFindUnique.mockResolvedValue({
    id: 10, slug: "gala", title: "Gala", isPublished: false, bankBsb: "013-999", bankAccount: "12345678",
  })

  await expect(render("gala", "REG-00042")).rejects.toThrow("NOT_FOUND")
  expect(mockRegFindFirst).not.toHaveBeenCalled()
})

it("looks up the registration by opaque token + event, never by sequential id", async () => {
  mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: null, bankAccount: null })
  mockRegFindFirst.mockResolvedValue(null)

  await render("gala", "REG-DEADBEEF12")

  // Token lookup defeats REG-1..N enumeration; never an unscoped/by-id query
  expect(mockRegFindUnique).not.toHaveBeenCalled()
  expect(mockRegFindFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ publicToken: "REG-DEADBEEF12", eventId: 10 }),
    })
  )
})

it("renders a cancelled state — not an active booking with bank details — for a CANCELLED registration", async () => {
  mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678" })
  mockRegFindFirst.mockResolvedValue({
    publicToken: "REG-CANCELLED1",
    firstName: "Jo",
    lastName: "Blogs",
    paymentStatus: "CANCELLED",
    totalAmount: { toString: () => "5000" },
    items: [],
  })

  const html = renderToStaticMarkup(await render("gala", "REG-CANCELLED1"))

  expect(html).toMatch(/cancelled/i)
  expect(html).not.toContain("Bank Transfer Details")
  expect(html).not.toMatch(/you&#x27;re registered/i)
})

it("expires the token 30 days after registration, OR-authorised by a recent SUCCESS reminder", async () => {
  mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: null, bankAccount: null })
  mockRegFindFirst.mockResolvedValue(null)

  const before = Date.now()
  await render("gala", "REG-DEADBEEF12")
  const after = Date.now()

  const where = mockRegFindFirst.mock.calls[0][0].where
  // The createdAt expiry is no longer a bare top-level filter — it's OR'd with a
  // recent-reminder branch so a reminded, >30-day-old unpaid registration still
  // resolves (Qodo bug 2). Leaked links still die 30 days after the last event.
  expect(where.createdAt).toBeUndefined()
  const createdFloor: Date = where.OR[0].createdAt.gte
  const reminderBranch = where.OR[1].paymentReminders.some
  const reminderFloor: Date = reminderBranch.sentAt.gte
  expect(createdFloor).toBeInstanceOf(Date)
  expect(reminderFloor).toBeInstanceOf(Date)
  expect(reminderBranch.status).toBe("SUCCESS")
  // Both floors are "now − 30 days"; allow for clock drift across the call.
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
  expect(createdFloor.getTime()).toBeGreaterThanOrEqual(before - THIRTY_DAYS - 1000)
  expect(createdFloor.getTime()).toBeLessThanOrEqual(after - THIRTY_DAYS + 1000)
  expect(reminderFloor.getTime()).toBeGreaterThanOrEqual(before - THIRTY_DAYS - 1000)
  expect(reminderFloor.getTime()).toBeLessThanOrEqual(after - THIRTY_DAYS + 1000)
})

it("throttles token lookups per IP and never queries when rate-limited", async () => {
  mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678" })
  mockRateLimit.mockReturnValue(false)

  const html = renderToStaticMarkup(await render("gala", "REG-DEADBEEF12"))

  expect(html).toMatch(/too many requests/i)
  // A throttled request must not reach the DB or disclose bank details.
  expect(mockRegFindFirst).not.toHaveBeenCalled()
  expect(html).not.toContain("12345678")
  expect(mockRateLimit).toHaveBeenCalledWith("success:1.2.3.4", 20, 60_000)
})

it("renders a check-in QR of the publicToken on a confirmed registration", async () => {
  mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: null, bankAccount: null })
  mockRegFindFirst.mockResolvedValue({
    publicToken: "REG-DEADBEEF12",
    firstName: "Jo",
    lastName: "Blogs",
    totalAmount: { toString: () => "0" },
    items: [],
  })

  const html = renderToStaticMarkup(await render("gala", "REG-DEADBEEF12"))

  expect(html).toMatch(/check-in code/i)
  expect(html).toContain("<svg")
  expect(html).toMatch(/show this at check-in/i)
})

it("does not query a registration when ref is missing/invalid", async () => {
  mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: null, bankAccount: null })

  await render("gala", "")

  expect(mockRegFindFirst).not.toHaveBeenCalled()
  expect(mockRegFindUnique).not.toHaveBeenCalled()
})

it("shows a not-found message — not bank details — when the ref matches no registration", async () => {
  mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678" })
  mockRegFindFirst.mockResolvedValue(null)

  const html = renderToStaticMarkup(await render("gala", "REG-BOGUS00000"))

  expect(html).toMatch(/not found/i)
  // The bogus ref must NOT be presented as a payment reference next to bank details.
  expect(html).not.toContain("Bank Transfer Details")
  expect(html).not.toContain("12345678")
  expect(html).not.toContain("You&#x27;re registered")
})

describe("card (pay-now) return via ?token= (Stripe event payments)", () => {
  it("resolves the registration through CheckoutSession.publicToken when the webhook has already stamped it", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: null, bankAccount: null })
    mockCheckoutSessionFindUnique.mockResolvedValue({ eventId: 10, publicToken: "REG-CARDPAID01" })
    mockRegFindFirst.mockResolvedValue({
      publicToken: "REG-CARDPAID01",
      firstName: "Jo",
      lastName: "Blogs",
      paymentStatus: "PAID",
      totalAmount: { toString: () => "5000" },
      items: [],
    })

    const html = renderToStaticMarkup(await renderWithToken("gala", "cs_test_abc123"))

    expect(mockCheckoutSessionFindUnique).toHaveBeenCalledWith({ where: { stripeSessionId: "cs_test_abc123" } })
    expect(mockRegFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ publicToken: "REG-CARDPAID01", eventId: 10 }) })
    )
    expect(html).toMatch(/you&#x27;re registered/i)
  })

  it("shows a 'payment received, being finalised' state — not 404 — when the webhook hasn't stamped publicToken yet", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: null, bankAccount: null })
    mockCheckoutSessionFindUnique.mockResolvedValue({ eventId: 10, publicToken: null })

    const html = renderToStaticMarkup(await renderWithToken("gala", "cs_test_pending"))

    expect(html).toMatch(/payment received/i)
    expect(html).toMatch(/being finalised/i)
    expect(mockRegFindFirst).not.toHaveBeenCalled()
  })

  it("shows the 'couldn't complete your registration' state — not 'being finalised' — for an EXPIRED session where a late webhook confirmed the charge", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678" })
    // Sweep flipped the row EXPIRED, then a late webhook (e.g. BECS) confirmed
    // the charge — customer was charged but the row was never token-stamped.
    mockCheckoutSessionFindUnique.mockResolvedValue({ eventId: 10, publicToken: null, status: "EXPIRED" })

    const html = renderToStaticMarkup(await renderWithToken("gala", "cs_test_expired"))

    expect(html).toMatch(/couldn&#x27;t complete your registration/i)
    expect(html).not.toMatch(/being finalised/i)
    expect(html).not.toContain("Bank Transfer Details")
    expect(mockRegFindFirst).not.toHaveBeenCalled()
  })

  it("shows the 'couldn't complete your registration' state for a COMPLETED session whose publicToken was withheld on a duplicate charge", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678" })
    // Genuine second charge inside the dedupe window: keeps the money for
    // manual ops and deliberately never stamps this payer's publicToken.
    mockCheckoutSessionFindUnique.mockResolvedValue({ eventId: 10, publicToken: null, status: "COMPLETED" })

    const html = renderToStaticMarkup(await renderWithToken("gala", "cs_test_dupcharge"))

    expect(html).toMatch(/couldn&#x27;t complete your registration/i)
    expect(html).not.toMatch(/being finalised/i)
    expect(mockRegFindFirst).not.toHaveBeenCalled()
  })

  it("still shows 'being finalised' for a genuinely pending pre-webhook session (OPEN, no token)", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: null, bankAccount: null })
    // Webhook simply hasn't landed yet — row still OPEN, no token. Transient, not terminal.
    mockCheckoutSessionFindUnique.mockResolvedValue({ eventId: 10, publicToken: null, status: "OPEN" })

    const html = renderToStaticMarkup(await renderWithToken("gala", "cs_test_open"))

    expect(html).toMatch(/being finalised/i)
    expect(html).not.toMatch(/couldn&#x27;t complete your registration/i)
    expect(mockRegFindFirst).not.toHaveBeenCalled()
  })

  it("falls through to the not-found view when the token matches no CheckoutSession", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678" })
    mockCheckoutSessionFindUnique.mockResolvedValue(null)

    const html = renderToStaticMarkup(await renderWithToken("gala", "cs_test_unknown"))

    expect(html).toMatch(/not found/i)
    expect(html).not.toContain("Bank Transfer Details")
    expect(mockRegFindFirst).not.toHaveBeenCalled()
  })

  it("coerces a duplicated ?token= array to its first value instead of crashing", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: null, bankAccount: null })
    mockCheckoutSessionFindUnique.mockResolvedValue({ eventId: 10, publicToken: "REG-CARDPAID01" })
    mockRegFindFirst.mockResolvedValue({
      publicToken: "REG-CARDPAID01", firstName: "Jo", lastName: "Blogs",
      paymentStatus: "PAID", totalAmount: { toString: () => "5000" }, items: [],
    })

    // ?token=cs_a&token=cs_b arrives as an array; `.startsWith` on it would throw
    // an unhandled TypeError (500). The page must take the first value.
    const page = SuccessPage({
      params: Promise.resolve({ slug: "gala" }),
      searchParams: Promise.resolve({ token: ["cs_test_abc123", "cs_test_dupe"] as unknown as string }),
    })
    const html = renderToStaticMarkup(await page)

    expect(mockCheckoutSessionFindUnique).toHaveBeenCalledWith({ where: { stripeSessionId: "cs_test_abc123" } })
    expect(html).toMatch(/you&#x27;re registered/i)
  })

  it("never looks up a CheckoutSession for a token missing the cs_ prefix", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: null, bankAccount: null })

    await renderWithToken("gala", "not-a-stripe-session-id")

    expect(mockCheckoutSessionFindUnique).not.toHaveBeenCalled()
    expect(mockRegFindFirst).not.toHaveBeenCalled()
  })

  it("does not resolve a CheckoutSession scoped to a different event (cross-event guard)", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678" })
    mockCheckoutSessionFindUnique.mockResolvedValue({ eventId: 999, publicToken: "REG-OTHEREVENT" })

    const html = renderToStaticMarkup(await renderWithToken("gala", "cs_test_othereventsession"))

    expect(html).toMatch(/not found/i)
    expect(mockRegFindFirst).not.toHaveBeenCalled()
  })
})

describe("PAID registration — no bank-details leak", () => {
  it("shows 'Paid by card' instead of bank BSB/account when the registration is card-PAID (paymentRef present)", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678" })
    mockRegFindFirst.mockResolvedValue({
      publicToken: "REG-PAID0001",
      firstName: "Jo",
      lastName: "Blogs",
      paymentStatus: "PAID",
      // Stripe webhook stamps the PaymentIntent id as paymentRef → paid by card.
      paymentRef: "pi_abc123",
      totalAmount: { toString: () => "5000" },
      items: [],
    })

    const html = renderToStaticMarkup(await render("gala", "REG-PAID0001"))

    expect(html).toMatch(/paid by card/i)
    expect(html).not.toContain("Bank Transfer Details")
    expect(html).not.toContain("12345678")
    expect(html).not.toContain("013-999")
  })

  it("shows 'Payment received' — NOT 'Paid by card' — for a manually-reconciled bank-transfer PAID registration (no paymentRef)", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678" })
    mockRegFindFirst.mockResolvedValue({
      publicToken: "REG-MANUAL01",
      firstName: "Jo",
      lastName: "Blogs",
      paymentStatus: "PAID",
      // markRegistrationPaid (office reconciled a bank transfer) sets no paymentRef.
      paymentRef: null,
      totalAmount: { toString: () => "5000" },
      items: [],
    })

    const html = renderToStaticMarkup(await render("gala", "REG-MANUAL01"))

    expect(html).toMatch(/payment received/i)
    expect(html).not.toMatch(/paid by card/i)
    // Still settled: no bank-transfer instructions shown.
    expect(html).not.toContain("Bank Transfer Details")
    expect(html).not.toContain("12345678")
  })

  it("still shows bank transfer details for a PENDING (pay-later) registration", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678" })
    mockRegFindFirst.mockResolvedValue({
      publicToken: "REG-PENDING1",
      firstName: "Jo",
      lastName: "Blogs",
      paymentStatus: "PENDING",
      totalAmount: { toString: () => "5000" },
      items: [],
    })

    const html = renderToStaticMarkup(await render("gala", "REG-PENDING1"))

    expect(html).toContain("Bank Transfer Details")
    expect(html).toContain("12345678")
    expect(html).not.toMatch(/paid by card/i)
  })
})

describe("$0 free registration — no payment required", () => {
  it("shows 'No payment required' — not bank details or the 7-day hold notice — for a PENDING $0 registration", async () => {
    mockEventFindUnique.mockResolvedValue({ id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678" })
    mockRegFindFirst.mockResolvedValue({
      publicToken: "REG-FREE00001",
      firstName: "Jo",
      lastName: "Blogs",
      paymentStatus: "PENDING",
      totalAmount: { toString: () => "0" },
      items: [],
    })

    const html = renderToStaticMarkup(await render("gala", "REG-FREE00001"))

    expect(html).toMatch(/no payment required/i)
    expect(html).not.toContain("Bank Transfer Details")
    expect(html).not.toContain("12345678")
    expect(html).not.toContain("013-999")
    expect(html).not.toMatch(/held for 7 days/i)
  })
})

describe("family waiver note", () => {
  it("shows the family-waiver note when items exceed the threshold on a waiver-enabled event", async () => {
    mockEventFindUnique.mockResolvedValue({
      id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: null, bankAccount: null,
      familyWaiverEnabled: true, familyWaiverThreshold: 3,
    })
    mockRegFindFirst.mockResolvedValue({
      publicToken: "REG-WAIVER001",
      firstName: "Jo",
      lastName: "Blogs",
      paymentStatus: "PENDING",
      totalAmount: { toString: () => "1000" },
      items: [
        {
          id: 1,
          quantity: 5,
          ticketType: { name: "Adult", price: { toString: () => "1000" }, countsTowardWaiver: true },
        },
      ],
    })

    const html = renderToStaticMarkup(await render("gala", "REG-WAIVER001"))

    expect(html).toContain("Family waiver applied")
    expect(html).toContain("2 members free")
  })

  it("does not show the family-waiver note when the event has no waiver enabled", async () => {
    mockEventFindUnique.mockResolvedValue({
      id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: null, bankAccount: null,
      familyWaiverEnabled: false, familyWaiverThreshold: 3,
    })
    mockRegFindFirst.mockResolvedValue({
      publicToken: "REG-NOWAIVER1",
      firstName: "Jo",
      lastName: "Blogs",
      paymentStatus: "PENDING",
      totalAmount: { toString: () => "5000" },
      items: [
        {
          id: 1,
          quantity: 5,
          ticketType: { name: "Adult", price: { toString: () => "1000" }, countsTowardWaiver: true },
        },
      ],
    })

    const html = renderToStaticMarkup(await render("gala", "REG-NOWAIVER1"))

    expect(html).not.toContain("Family waiver applied")
  })
})

describe("pay-now-by-card button gating (Task 7)", () => {
  it("renders the button on a PENDING registration when the event has online payment enabled and Stripe is configured", async () => {
    mockStripeConfigured.mockReturnValue(true)
    mockEventFindUnique.mockResolvedValue({
      id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678",
      onlinePaymentEnabled: true, passCardFee: false,
    })
    mockRegFindFirst.mockResolvedValue({
      publicToken: "REG-PENDING2",
      firstName: "Jo",
      lastName: "Blogs",
      paymentStatus: "PENDING",
      totalAmount: { toString: () => "5000" },
      items: [],
    })

    const html = renderToStaticMarkup(await render("gala", "REG-PENDING2"))

    expect(html).toMatch(/pay now by card/i)
  })

  it("does not render the button when the event has online payment disabled", async () => {
    mockStripeConfigured.mockReturnValue(true)
    mockEventFindUnique.mockResolvedValue({
      id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678",
      onlinePaymentEnabled: false, passCardFee: false,
    })
    mockRegFindFirst.mockResolvedValue({
      publicToken: "REG-PENDING3",
      firstName: "Jo",
      lastName: "Blogs",
      paymentStatus: "PENDING",
      totalAmount: { toString: () => "5000" },
      items: [],
    })

    const html = renderToStaticMarkup(await render("gala", "REG-PENDING3"))

    expect(html).not.toMatch(/pay now by card/i)
  })

  it("does not render the button when Stripe is not configured, even if the event has online payment enabled", async () => {
    mockStripeConfigured.mockReturnValue(false)
    mockEventFindUnique.mockResolvedValue({
      id: 10, slug: "gala", title: "Gala", isPublished: true, bankBsb: "013-999", bankAccount: "12345678",
      onlinePaymentEnabled: true, passCardFee: false,
    })
    mockRegFindFirst.mockResolvedValue({
      publicToken: "REG-PENDING4",
      firstName: "Jo",
      lastName: "Blogs",
      paymentStatus: "PENDING",
      totalAmount: { toString: () => "5000" },
      items: [],
    })

    const html = renderToStaticMarkup(await render("gala", "REG-PENDING4"))

    expect(html).not.toMatch(/pay now by card/i)
  })
})
