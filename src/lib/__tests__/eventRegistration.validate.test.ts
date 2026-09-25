// Regression test for Task 3: validateAndPriceRegistration must price a
// registration WITHOUT writing to the database — the DB write belongs solely
// to persistRegistration. This is the seam the pay-later flow (and the future
// Stripe webhook) will call independently of persistence.

jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
    $transaction: jest.fn(),
    registration: { create: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  hmacEmail: jest.fn((v: string) => `hash:${v.trim().toLowerCase()}`),
}))
jest.mock("@/lib/formToken", () => ({
  verifyFormToken: jest.fn(() => "ok"),
}))
jest.mock("@/lib/turnstile", () => ({
  verifyTurnstile: jest.fn(() => Promise.resolve(true)),
}))
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => true),
}))
jest.mock("@/lib/email", () => ({
  sendRegistrationConfirmationEmail: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/ics", () => ({
  buildIcs: jest.fn(() => "BEGIN:VCALENDAR..."),
  googleCalendarUrl: jest.fn(() => "https://calendar.google.com/render"),
}))
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))

import { validateAndPriceRegistration, type EventWithTickets } from "@/lib/eventRegistrationPricing"
import { prisma } from "@/lib/prisma"

// Small factory for the EventWithTickets shape validateAndPriceRegistration
// consumes — modeled on makeEvent() in the characterization suite.
function makeEventWithTickets(overrides: Record<string, unknown> = {}): EventWithTickets {
  return {
    id: 1,
    slug: "fete",
    title: "Spring Fete",
    isPublished: true,
    date: null,
    endDate: null,
    description: null,
    location: null,
    bankBsb: "062-000",
    bankAccount: "12345678",
    customQuestions: [],
    ticketTypes: [
      { id: 1, name: "Adult", price: 10, capacity: null, registrationItems: [] },
      { id: 2, name: "Child", price: 5, capacity: null, registrationItems: [] },
    ],
    ...overrides,
  } as unknown as EventWithTickets
}

beforeEach(() => {
  jest.clearAllMocks()
})

it("validateAndPriceRegistration prices tickets without creating a registration", async () => {
  const event = makeEventWithTickets({
    ticketTypes: [{ id: 1, name: "Adult", price: "10.00", capacity: null, registrationItems: [] }],
  })
  const res = await validateAndPriceRegistration(
    event,
    {
      firstName: "A",
      lastName: "B",
      email: "a@b.com",
      tickets: { "1": 2 },
      attendeeNames: { "1": ["X", "Y"] },
      website: "",
      formToken: "irrelevant-because-mocked",
    },
    "1.1.1.1",
  )

  expect(res.ok).toBe(true)
  if (res.ok) {
    expect(res.priced.totalAmount).toBe(20)
    expect(res.priced.items[0].unitPrice).toBe(10)
  }
  expect(prisma.registration.create).not.toHaveBeenCalled()
})

it("applies the family waiver — 5th counted attendee is free", async () => {
  const event = makeEventWithTickets({
    familyWaiverEnabled: true,
    familyWaiverThreshold: 4,
    ticketTypes: [
      { id: 1, name: "Member", price: "10.00", capacity: null, countsTowardWaiver: true, registrationItems: [] },
    ],
  })
  const res = await validateAndPriceRegistration(
    event,
    {
      firstName: "A", lastName: "B", email: "a@b.com",
      tickets: { "1": 5 },
      attendeeNames: { "1": ["V", "W", "X", "Y", "Z"] },
      website: "", formToken: "mocked",
    },
    "1.1.1.1",
  )
  expect(res.ok).toBe(true)
  if (res.ok) {
    // 5 * $10 = $50, one waived → $40
    expect(res.priced.totalAmount).toBe(40)
    expect(res.priced.waivedCount).toBe(1)
    // unitPrice snapshot stays the true ticket price
    expect(res.priced.items[0].unitPrice).toBe(10)
  }
})

it("waiver never touches a non-counted (Visitor) ticket type", async () => {
  const event = makeEventWithTickets({
    familyWaiverEnabled: true,
    familyWaiverThreshold: 4,
    ticketTypes: [
      { id: 1, name: "Member", price: "10.00", capacity: null, countsTowardWaiver: true, registrationItems: [] },
      { id: 2, name: "Visitor", price: "25.00", capacity: null, countsTowardWaiver: false, registrationItems: [] },
    ],
  })
  const res = await validateAndPriceRegistration(
    event,
    {
      firstName: "A", lastName: "B", email: "a@b.com",
      tickets: { "1": 5, "2": 3 },
      attendeeNames: { "1": ["a", "b", "c", "d", "e"], "2": ["p", "q", "r"] },
      website: "", formToken: "mocked",
    },
    "1.1.1.1",
  )
  expect(res.ok).toBe(true)
  if (res.ok) {
    // Member: 5*$10 = $50, 1 waived → $40. Visitor: 3*$25 = $75, untouched.
    expect(res.priced.totalAmount).toBe(115)
    expect(res.priced.waivedCount).toBe(1)
  }
})

describe("tiered family pricing", () => {
  it("prices the whole registration by headcount, ignoring ticket prices", async () => {
    const event = makeEventWithTickets({
      tieredPricingEnabled: true,
      familyPricingTiers: [60, 120, 150, 180],
      familyWaiverEnabled: false,
      ticketTypes: [
        { id: 1, name: "Child", price: 999, capacity: null, countsTowardWaiver: true, registrationItems: [] },
      ],
    })
    const res = await validateAndPriceRegistration(
      event,
      {
        firstName: "A", lastName: "B", email: "a@b.com",
        tickets: { "1": 3 },
        attendeeNames: { "1": ["X", "Y", "Z"] },
        website: "", formToken: "mocked",
      },
      "1.1.1.1",
    )
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.priced.totalAmount).toBe(150) // schedule, not 3 × 999
  })

  it("rejects a group larger than the table", async () => {
    const event = makeEventWithTickets({
      tieredPricingEnabled: true,
      familyPricingTiers: [60, 120, 150, 180],
      ticketTypes: [
        { id: 1, name: "Child", price: 60, capacity: null, countsTowardWaiver: true, registrationItems: [] },
      ],
    })
    const res = await validateAndPriceRegistration(
      event,
      {
        firstName: "A", lastName: "B", email: "a@b.com",
        tickets: { "1": 5 },
        attendeeNames: { "1": ["a", "b", "c", "d", "e"] },
        website: "", formToken: "mocked",
      },
      "1.1.1.1",
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(400)
      expect(res.error).toMatch(/maximum of 4 registrants/)
    }
  })
})

describe("ticketTypeId key canonicalization ( oversell)", () => {
  it("merges aliased numeric-string keys before the capacity check instead of double-counting", async () => {
    const event = makeEventWithTickets({
      ticketTypes: [
        { id: 1, name: "Adult", price: "10.00", capacity: 1, registrationItems: [] },
      ],
    })
    // "1" and "01" both parseInt to ticketTypeId 1 — must be treated as ONE
    // line item (quantity 2) and rejected against capacity 1, never as two
    // separate quantity-1 items that each pass the same stale capacity snapshot.
    const res = await validateAndPriceRegistration(
      event,
      {
        firstName: "A", lastName: "B", email: "a@b.com",
        tickets: { "1": 1, "01": 1 },
        attendeeNames: { "1": ["X"], "01": ["Y"] },
        website: "", formToken: "mocked",
      },
      "1.1.1.1",
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(400)
      expect(res.error).toMatch(/sold out/)
    }
  })

  it("rejects a non-digit ticketTypeId key (e.g. \"+1\") at the schema layer", async () => {
    const event = makeEventWithTickets({
      ticketTypes: [
        { id: 1, name: "Adult", price: "10.00", capacity: null, registrationItems: [] },
      ],
    })
    const res = await validateAndPriceRegistration(
      event,
      {
        firstName: "A", lastName: "B", email: "a@b.com",
        tickets: { "+1": 1 },
        attendeeNames: { "+1": ["X"] },
        website: "", formToken: "mocked",
      },
      "1.1.1.1",
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(400)
  })
})

it("no waiver when disabled even with 6 attendees", async () => {
  const event = makeEventWithTickets({
    familyWaiverEnabled: false,
    familyWaiverThreshold: 4,
    ticketTypes: [
      { id: 1, name: "Member", price: "10.00", capacity: null, countsTowardWaiver: true, registrationItems: [] },
    ],
  })
  const res = await validateAndPriceRegistration(
    event,
    {
      firstName: "A", lastName: "B", email: "a@b.com",
      tickets: { "1": 6 },
      attendeeNames: { "1": ["a", "b", "c", "d", "e", "f"] },
      website: "", formToken: "mocked",
    },
    "1.1.1.1",
  )
  expect(res.ok).toBe(true)
  if (res.ok) {
    expect(res.priced.totalAmount).toBe(60)
    expect(res.priced.waivedCount).toBe(0)
  }
})
