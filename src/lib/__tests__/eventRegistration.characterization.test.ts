// Characterization tests for createEventRegistration (Task 3a — regression gate
// for the Task 3b refactor that extracts validateAndPriceRegistration +
// persistRegistration). These pin CURRENT observable behavior; they must pass
// against the unmodified src/lib/eventRegistration.ts. If a test is red, the
// test is wrong — never "fix" the source to make one pass.

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
import { sendRegistrationConfirmationEmail } from "@/lib/email"

const findUnique = prisma.event.findUnique as jest.Mock
const $transaction = prisma.$transaction as jest.Mock
const verifyFormTokenMock = verifyFormToken as jest.Mock
const verifyTurnstileMock = verifyTurnstile as jest.Mock
const rateLimitMock = rateLimit as jest.Mock
const sendConfirmationMock = sendRegistrationConfirmationEmail as jest.Mock

// Mock transaction client passed into the `$transaction(async (tx) => {...})`
// callback — matches exactly the delegates the real callback body calls:
// tx.registration.findFirst/create, tx.registrationItem.aggregate/create.
let tx: {
  registration: { findFirst: jest.Mock; create: jest.Mock }
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
  sendConfirmationMock.mockResolvedValue(undefined)
})

describe("createEventRegistration — happy path & pricing", () => {
  it("returns { ok: true, ref }, creates the registration with encrypted email + totalAmount 20, and attempts confirmation email", async () => {
    findUnique.mockResolvedValue(makeEvent())
    tx.registration.create.mockResolvedValue({ id: 1, publicToken: "REG-TESTTOKEN" })

    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")

    expect(result).toEqual({ ok: true, ref: "REG-TESTTOKEN" })
    expect(tx.registration.create).toHaveBeenCalledTimes(1)
    expect(tx.registration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: 1,
        firstName: "Jane",
        lastName: "Doe",
        email: "enc:jane@example.com",
        emailHash: "hash:jane@example.com",
        phone: null,
        customAnswers: undefined,
        totalAmount: 20,
        publicToken: expect.stringMatching(/^REG-[0-9A-F]{12}$/),
      }),
    })
    // Serializable isolation is load-bearing for the sold-out/idempotency
    // races — pin it as part of the txn call shape.
    expect($transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    expect(sendConfirmationMock).toHaveBeenCalledTimes(1)
  })

  it("prices a 2-ticket-type basket as the exact sum of quantity x unitPrice (2 Adult @ $10 + 1 Child @ $5 = $25)", async () => {
    findUnique.mockResolvedValue(makeEvent())
    tx.registration.create.mockResolvedValue({ id: 2, publicToken: "REG-PRICE" })

    const body = makeBody({
      tickets: { "1": 2, "2": 1 },
      attendeeNames: { "1": ["Jane Doe", "John Doe"], "2": ["Baby Doe"] },
    })
    const result = await createEventRegistration("fete", body, "1.2.3.4")

    expect(result).toEqual({ ok: true, ref: "REG-PRICE" })
    expect(tx.registration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ totalAmount: 25 }),
    })
  })
})

describe("createEventRegistration — sold out & idempotency", () => {
  it("throws SoldOutError from the authoritative in-txn capacity re-check → { ok: false, status: 400, error: '<name> tickets sold out' }", async () => {
    // Pre-txn cheap check passes (0 sold, capacity 1, requesting 1); the
    // authoritative re-check inside the txn sees a concurrent registration
    // already took the seat (aggregate now reports 1 sold) and rejects.
    findUnique.mockResolvedValue(
      makeEvent({
        ticketTypes: [
          { id: 1, name: "Adult", price: 10, capacity: 1, registrationItems: [{ quantity: 0 }] },
        ],
      }),
    )
    tx.ticketType.findUnique.mockResolvedValue({ capacity: 1 })
    tx.registrationItem.aggregate.mockResolvedValue({ _sum: { quantity: 1 } })

    const body = makeBody({ tickets: { "1": 1 }, attendeeNames: { "1": ["Jane Doe"] } })
    const result = await createEventRegistration("fete", body, "1.2.3.4")

    expect(result).toEqual({ ok: false, status: 400, error: "Adult tickets sold out" })
    expect(tx.registration.create).not.toHaveBeenCalled()
  })

  it("returns the existing publicToken on a dedupe hit and does not create a second registration or send a second email", async () => {
    findUnique.mockResolvedValue(makeEvent())
    tx.registration.findFirst.mockResolvedValue({ publicToken: "REG-EXISTING" })

    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")

    expect(result).toEqual({ ok: true, ref: "REG-EXISTING", duplicate: true })
    expect(tx.registration.create).not.toHaveBeenCalled()
    expect(sendConfirmationMock).not.toHaveBeenCalled()
  })
})

describe("createEventRegistration — validation rejects", () => {
  it("event not found → 404 Event not found", async () => {
    findUnique.mockResolvedValue(null)
    const result = await createEventRegistration("nope", makeBody(), "1.2.3.4")
    expect(result).toEqual({ ok: false, status: 404, error: "Event not found" })
  })

  it("unpublished event → 404 Event not found (indistinguishable from missing)", async () => {
    findUnique.mockResolvedValue(makeEvent({ isPublished: false }))
    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")
    expect(result).toEqual({ ok: false, status: 404, error: "Event not found" })
  })

  it("Zod parse failure → 400 with the first issue's message", async () => {
    findUnique.mockResolvedValue(makeEvent())
    const result = await createEventRegistration("fete", makeBody({ email: "not-an-email" }), "1.2.3.4")
    expect(result).toEqual({ ok: false, status: 400, error: "Invalid email address" })
  })

  it("honeypot filled → 400 Registration failed (generic — never hints honeypot)", async () => {
    findUnique.mockResolvedValue(makeEvent())
    const result = await createEventRegistration("fete", makeBody({ website: "http://spam.example" }), "1.2.3.4")
    expect(result).toEqual({ ok: false, status: 400, error: "Registration failed" })
  })

  // verifyFormToken's "tooFast" branch is the only one that maps to the same
  // generic "Registration failed" as the honeypot; missing/bad/expired map to
  // a different, more specific message (next test) — both pinned exactly as
  // the source produces them.
  it("formToken submitted too fast → 400 Registration failed", async () => {
    findUnique.mockResolvedValue(makeEvent())
    verifyFormTokenMock.mockReturnValue("tooFast")
    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")
    expect(result).toEqual({ ok: false, status: 400, error: "Registration failed" })
  })

  it("formToken missing/bad/expired → 400 with the session-expired message", async () => {
    findUnique.mockResolvedValue(makeEvent())
    verifyFormTokenMock.mockReturnValue("expired")
    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Your session expired. Please refresh the page and try again.",
    })
  })

  it("Turnstile verification failure → 400 Registration failed", async () => {
    findUnique.mockResolvedValue(makeEvent())
    verifyTurnstileMock.mockResolvedValue(false)
    const result = await createEventRegistration("fete", makeBody({ turnstileToken: "bad-token" }), "1.2.3.4")
    expect(result).toEqual({ ok: false, status: 400, error: "Registration failed" })
  })

  it("zero tickets selected → 400 Select at least one ticket", async () => {
    findUnique.mockResolvedValue(makeEvent())
    const result = await createEventRegistration("fete", makeBody({ tickets: {}, attendeeNames: {} }), "1.2.3.4")
    expect(result).toEqual({ ok: false, status: 400, error: "Select at least one ticket" })
  })

  it("unknown ticket type id → 400 Invalid ticket type", async () => {
    findUnique.mockResolvedValue(makeEvent())
    const result = await createEventRegistration(
      "fete",
      makeBody({ tickets: { "999": 1 }, attendeeNames: { "999": ["Jane Doe"] } }),
      "1.2.3.4",
    )
    expect(result).toEqual({ ok: false, status: 400, error: "Invalid ticket type" })
  })

  it("registrationClosed true → 400 Registration for this event is closed (distinct from the 404 unpublished/past events use)", async () => {
    findUnique.mockResolvedValue(
      makeEvent({ date: new Date("2999-01-01"), registrationClosed: true, registrationDeadline: null }),
    )
    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")
    expect(result).toEqual({ ok: false, status: 400, error: "Registration for this event is closed." })
  })

  it("registrationDeadline in the past → 400 Registration for this event is closed", async () => {
    findUnique.mockResolvedValue(
      makeEvent({ date: new Date("2999-01-01"), registrationClosed: false, registrationDeadline: new Date("2000-01-01") }),
    )
    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")
    expect(result).toEqual({ ok: false, status: 400, error: "Registration for this event is closed." })
  })
})

describe("createEventRegistration — capacity re-check races", () => {
  it("re-checks capacity in-txn even for a type that was UNLIMITED at pricing time ( oversell)", async () => {
    // Snapshot at validation time has capacity: null (unlimited) — pricing must
    // still hand this ticket type to the in-txn authoritative re-check, because
    // an admin can lower it to a finite capacity before the transaction commits.
    findUnique.mockResolvedValue(
      makeEvent({
        ticketTypes: [
          { id: 1, name: "Adult", price: 10, capacity: null, registrationItems: [] },
        ],
      }),
    )
    // Simulates the admin having lowered capacity to 1 (already fully sold)
    // between the pricing snapshot and this transaction.
    tx.ticketType.findUnique.mockResolvedValue({ capacity: 1 })
    tx.registrationItem.aggregate.mockResolvedValue({ _sum: { quantity: 1 } })

    const body = makeBody({ tickets: { "1": 1 }, attendeeNames: { "1": ["Jane Doe"] } })
    const result = await createEventRegistration("fete", body, "1.2.3.4")

    expect(result).toEqual({ ok: false, status: 400, error: "Adult tickets sold out" })
    expect(tx.registration.create).not.toHaveBeenCalled()
  })

  it("returns a clean unavailable result (not a raw FK error) when a selected ticket type was deleted before the transaction", async () => {
    findUnique.mockResolvedValue(
      makeEvent({
        ticketTypes: [
          { id: 1, name: "Adult", price: 10, capacity: 5, registrationItems: [{ quantity: 0 }] },
        ],
      }),
    )
    // Simulates the ticket type having been deleted by an admin after
    // validation but before this transaction's in-txn re-read.
    tx.ticketType.findUnique.mockResolvedValue(null)

    const body = makeBody({ tickets: { "1": 1 }, attendeeNames: { "1": ["Jane Doe"] } })
    const result = await createEventRegistration("fete", body, "1.2.3.4")

    expect(result).toEqual({ ok: false, status: 400, error: "Adult is no longer available" })
    expect(tx.registration.create).not.toHaveBeenCalled()
  })
})

describe("createEventRegistration — serialization conflicts", () => {
  it("P2034 on every attempt exhausts the 3-attempt retry loop → 409 Registration is busy, please try again", async () => {
    findUnique.mockResolvedValue(makeEvent())
    $transaction.mockRejectedValue({ code: "P2034" })

    const result = await createEventRegistration("fete", makeBody(), "1.2.3.4")

    expect(result).toEqual({ ok: false, status: 409, error: "Registration is busy, please try again" })
    expect($transaction).toHaveBeenCalledTimes(3)
  })
})
