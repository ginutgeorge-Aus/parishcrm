// AUD-2-03: overall caps on the public (unpaid) registration path — confirmation
// mail budgets (per event, global), URL-bearing names, and PENDING seat hoarding.

jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}))
// Deterministic stand-ins for the real AES-256-GCM crypto — see
// the repo's canonical crypto mock pattern.
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
jest.mock("@/lib/dbRateLimit", () => ({
  dbRateLimit: jest.fn(() => Promise.resolve(true)),
}))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn(async () => ({ name: "Test Church", address: "", abn: "", email: "", website: "" })),
}))
jest.mock("@/lib/email", () => ({
  sendRegistrationConfirmationEmail: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/ics", () => ({
  buildIcs: jest.fn(() => "BEGIN:VCALENDAR..."),
  googleCalendarUrl: jest.fn(() => "https://calendar.google.com/render"),
}))
// The real generated client's module-level init (cuid2 salt via
// @noble/hashes) needs a WebCrypto TextEncoder that jsdom's test env doesn't
// provide — importing it for real crashes the suite before a single test
// runs. Same mock shape as __tests__/actions/reconciliation.test.ts.
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))

import { createEventRegistration } from "@/lib/eventRegistration"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma/client"
import { verifyFormToken } from "@/lib/formToken"
import { verifyTurnstile } from "@/lib/turnstile"
import { rateLimit } from "@/lib/rateLimit"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { sendRegistrationConfirmationEmail } from "@/lib/email"

const findUnique = prisma.event.findUnique as jest.Mock
const $transaction = prisma.$transaction as jest.Mock
const verifyFormTokenMock = verifyFormToken as jest.Mock
const verifyTurnstileMock = verifyTurnstile as jest.Mock
const rateLimitMock = rateLimit as jest.Mock
const dbRateLimitMock = dbRateLimit as jest.Mock
const sendConfirmationMock = sendRegistrationConfirmationEmail as jest.Mock

// Mock transaction client passed into the `$transaction(async (tx) => {...})`
// callback — matches exactly the delegates the real callback body calls:
// tx.registration.findFirst/create, tx.registrationItem.aggregate/create.
let tx: {
  registration: { findFirst: jest.Mock; create: jest.Mock; count: jest.Mock }
  registrationItem: { aggregate: jest.Mock; create: jest.Mock }
  ticketType: { findUnique: jest.Mock }
}

function makeEvent(overrides: Record<string, unknown> = {}) {
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
  }
}

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    tickets: { "1": 2 },
    attendeeNames: { "1": ["Jane Doe", "John Doe"] },
    website: "",
    formToken: "irrelevant-because-mocked",
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  tx = {
    registration: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 1, publicToken: "REG-DEFAULT" }),
      count: jest.fn().mockResolvedValue(0),
    },
    registrationItem: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      create: jest.fn().mockResolvedValue({}),
    },
    // In-txn capacity re-read: every selected ticket type is
    // re-read now, including capacity-null (unlimited) ones — default
    // to unlimited so the fixtures' capacity-null ticket types (the common
    // case) don't spuriously sold-out; tests exercising a finite capacity
    // override this per-test.
    ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) },
  }
  $transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))
  verifyFormTokenMock.mockReturnValue("ok")
  verifyTurnstileMock.mockResolvedValue(true)
  rateLimitMock.mockReturnValue(true)
  dbRateLimitMock.mockResolvedValue(true)
  sendConfirmationMock.mockResolvedValue(undefined)
})

describe("AUD-2-03 — confirmation mail budgets", () => {
  it("skips the confirmation email when the per-event budget is exhausted; registration still created", async () => {
    findUnique.mockResolvedValue(makeEvent())
    dbRateLimitMock.mockImplementation(async (key: string) => !key.startsWith("regmail:event:"))

    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")

    expect(result.ok).toBe(true)
    expect(tx.registration.create).toHaveBeenCalledTimes(1)
    expect(sendConfirmationMock).not.toHaveBeenCalled()
    expect(dbRateLimitMock).toHaveBeenCalledWith("regmail:event:1", 200, 3_600_000)
  })

  it("skips the confirmation email when the global daily budget is exhausted; registration still created", async () => {
    findUnique.mockResolvedValue(makeEvent())
    dbRateLimitMock.mockImplementation(async (key: string) => key !== "regmail:global")

    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")

    expect(result.ok).toBe(true)
    expect(sendConfirmationMock).not.toHaveBeenCalled()
    expect(dbRateLimitMock).toHaveBeenCalledWith("regmail:global", 500, 86_400_000)
  })

  it("still sends when both budgets have room", async () => {
    findUnique.mockResolvedValue(makeEvent())
    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")
    expect(result.ok).toBe(true)
    expect(sendConfirmationMock).toHaveBeenCalledTimes(1)
  })

  it("skips the send (registration still created) when the budget store throws", async () => {
    findUnique.mockResolvedValue(makeEvent())
    dbRateLimitMock.mockRejectedValue(new Error("db down"))
    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")
    expect(result.ok).toBe(true)
    expect(sendConfirmationMock).not.toHaveBeenCalled()
  })
})

describe("AUD-2-03 — name fields", () => {
  it.each(["A.Smith", "J.R. Tolkien", "Mary-Jane O.Brien", "St.John", "Mr.Au"])("still accepts dotted name %s", async (firstName) => {
    findUnique.mockResolvedValue(makeEvent())
    const result = await createEventRegistration("fete", makeBody({ firstName }), "1.2.3.4")
    expect(result.ok).toBe(true)
  })

  it.each([
    ["first name URL", { firstName: "Visit http://evil.example" }],
    ["last name www", { lastName: "see www.evil.example" }],
    ["attendee name URL", { attendeeNames: { "1": ["Jane Doe", "https://evil.example"] } }],
    ["bare domain in first name", { firstName: "visit bit.ly/x" }],
    ["bare .com in last name", { lastName: "evil.com" }],
    ["bare domain in attendee name", { attendeeNames: { "1": ["Jane Doe", "free-gift.xyz"] } }],
    ["unlisted-TLD domain", { firstName: "evil.co" }],
    ["short host with path", { firstName: "t.ly/x" }],
    ["first name over 60 chars", { firstName: "a".repeat(61) }],
    ["last name over 60 chars", { lastName: "a".repeat(61) }],
  ])("rejects %s with 400 and writes nothing", async (_n, override) => {
    findUnique.mockResolvedValue(makeEvent())
    const result = await createEventRegistration("fete", makeBody(override), "1.2.3.4")
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(tx.registration.create).not.toHaveBeenCalled()
  })
})

describe("AUD-2-03 — PENDING seat hoarding", () => {
  it("rejects a third live PENDING registration for the same email and event", async () => {
    findUnique.mockResolvedValue(makeEvent())
    tx.registration.count.mockResolvedValue(2)

    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")

    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(tx.registration.create).not.toHaveBeenCalled()
    expect(sendConfirmationMock).not.toHaveBeenCalled()
    expect(tx.registration.count).toHaveBeenCalledWith({
      where: { eventId: 1, emailHash: "hash:jane@example.com", paymentStatus: "PENDING" },
    })
  })

  it("does not cap free registrations on unlimited tickets (they never leave PENDING)", async () => {
    findUnique.mockResolvedValue(
      makeEvent({ ticketTypes: [{ id: 1, name: "Free", price: 0, capacity: null, registrationItems: [] }] }),
    )
    tx.registration.count.mockResolvedValue(5)
    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")
    expect(result.ok).toBe(true)
    expect(tx.registration.count).not.toHaveBeenCalled()
  })

  it("still caps free registrations on a capacity-limited ticket (seat hoarding)", async () => {
    findUnique.mockResolvedValue(
      makeEvent({ ticketTypes: [{ id: 1, name: "Free", price: 0, capacity: 50, registrationItems: [] }] }),
    )
    tx.registration.count.mockResolvedValue(2)
    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")
    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it("allows the second PENDING registration", async () => {
    findUnique.mockResolvedValue(makeEvent())
    tx.registration.count.mockResolvedValue(1)
    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")
    expect(result.ok).toBe(true)
  })
})
