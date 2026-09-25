/** @jest-environment node */
import { POST } from "@/app/api/events/[slug]/register/route"
import { prisma } from "@/lib/prisma"
import { NextRequest } from "next/server"
import { issueFormToken } from "@/lib/formToken"
import { sendRegistrationConfirmationEmail } from "@/lib/email"

// A token stamped ~5s in the past clears the 3s timing trap and is well within
// the 2h max age — injected into every request unless a test overrides it.
const validToken = () => issueFormToken(Date.now() - 5_000)

jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
    registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    registrationItem: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  hmacEmail: jest.fn((v: string) => `hash:${v.trim().toLowerCase()}`),
}))
// Mock the confirmation email so tests assert it was (or wasn't) sent without
// touching SMTP. rateLimit is intentionally NOT mocked — the real in-memory
// limiter backs both the per-IP 429 test and the recipient-throttle test below.
jest.mock("@/lib/email", () => ({
  sendRegistrationConfirmationEmail: jest.fn(async () => {}),
}))

// Unique IP per request — the module-level rate limiter (10 req/min/IP)
// persists across tests in this file and would 429 later tests otherwise.
// Pass an explicit ip to exercise the rate limiter itself.
let ipCounter = 0
const makeRequest = (body: object, ip?: string) => {
  const full = { formToken: validToken(), ...body } as {
    formToken: string
    tickets?: Record<string, number>
    attendeeNames?: Record<string, string[]>
  }
  // Names are required per ticket unit. Auto-fill to match the tickets map so
  // every test posting tickets stays valid, unless it sets attendeeNames itself
  // (e.g. the count-mismatch test). Cap generation at 100 — Zod rejects qty>100
  // at parse anyway, and an unbounded Array.from would OOM on the >100 test.
  if (full.tickets && !("attendeeNames" in full)) {
    const an: Record<string, string[]> = {}
    for (const [id, qty] of Object.entries(full.tickets)) {
      if (qty > 0) an[id] = Array.from({ length: Math.min(qty, 100) }, (_, i) => `Attendee ${id}-${i + 1}`)
    }
    full.attendeeNames = an
  }
  const payload = JSON.stringify(full)
  return new NextRequest("http://localhost/api/events/harvest/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(payload)),
      "x-forwarded-for": ip ?? `10.0.0.${++ipCounter}`,
    },
    body: payload,
  })
}

const mockEvent = {
  id: 1,
  isPublished: true,
  ticketTypes: [
    { id: 1, name: "Adult", price: 45, capacity: null, registrationItems: [] },
  ],
  customQuestions: null,
}

describe("POST /api/events/[slug]/register", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns 404 if event not found", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(null)
    const res = await POST(makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: {} }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(404)
  })

  it("returns 404 if event not published — indistinguishable from not-found", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ ...mockEvent, isPublished: false })
    const res = await POST(makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe("Event not found")
  })

  it("returns 404 for a past event — registration closed", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ ...mockEvent, date: new Date("2020-01-01"), endDate: null })
    const res = await POST(makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe("Event not found")
  })

  it("uses endDate over date to decide a multi-day event is still open", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ ...mockEvent, date: new Date("2020-01-01"), endDate: new Date("2999-12-31") })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 1 }) }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
    const res = await POST(makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(200)
  })

  it("computes totalAmount in exact cents with no float drift", async () => {
    // 3.33 * 7 = 23.310000000000002 under naive float accumulation.
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      ...mockEvent,
      ticketTypes: [{ id: 1, name: "Adult", price: 3.33, capacity: null, registrationItems: [] }],
    })
    const createMock = jest.fn().mockResolvedValue({ id: 1, publicToken: "tok" })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: createMock }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
    const res = await POST(makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 7 } }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(200)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalAmount: 23.31 }) })
    )
  })

  it("allows registration on a recurring event with no date set", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ ...mockEvent, date: null, endDate: null })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 1 }) }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
    const res = await POST(makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(200)
  })

  it("returns 400 if no tickets selected", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const res = await POST(makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: {} }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(400)
  })

  it("returns 400 if required field missing", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const res = await POST(makeRequest({ lastName: "B", email: "a@b.com", tickets: { "1": 1 } }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(400)
  })

  it("creates registration and returns the opaque ref token on success", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 42, publicToken: "REG-DEADBEEF12" }) }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", phone: "", tickets: { "1": 2 }, customAnswers: {} }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    // Opaque token, not the sequential id — defeats success-page enumeration
    expect(body.ref).toBe("REG-DEADBEEF12")
    expect(body.registrationId).toBeUndefined()
  })

  it("is idempotent: a duplicate submit within the window creates no new row and sends no duplicate email", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const create = jest.fn()
    const findFirst = jest.fn().mockResolvedValue({ publicToken: "REG-ORIGINAL01" })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst, create }, registrationItem: { create: jest.fn(), aggregate: jest.fn() } })
    )
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
    expect((await res.json()).duplicate).toBe(true)
    // Idempotency lookup scoped by the email blind index, non-CANCELLED only.
    expect(findFirst.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        eventId: 1,
        emailHash: "hash:a@b.com",
        paymentStatus: { not: "CANCELLED" },
      })
    )
    expect(create).not.toHaveBeenCalled()
    expect(sendRegistrationConfirmationEmail).not.toHaveBeenCalled()
  })

  // (SECURITY): the dedupe match has no proof the second caller is the
  // original submitter — anyone reusing a victim's email within the 10-minute
  // window must NOT receive the victim's publicToken (success-page secret AND
  // check-in QR credential) via this response.
  it("does not echo the original registration's publicToken to a duplicate submitter", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const create = jest.fn()
    const findFirst = jest.fn().mockResolvedValue({ publicToken: "REG-VICTIM0001" })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst, create }, registrationItem: { create: jest.fn(), aggregate: jest.fn() } })
    )
    const res = await POST(
      makeRequest({ firstName: "Mal", lastName: "Actor", email: "a@b.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.duplicate).toBe(true)
    expect(body.ref).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain("REG-VICTIM0001")
  })

  it("persists a CSPRNG publicToken on the registration", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const create = jest.fn().mockResolvedValue({ id: 42, publicToken: "REG-X" })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
    await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(create.mock.calls[0][0].data.publicToken).toMatch(/^REG-[0-9A-F]{12}$/)
  })

  it("returns 413 when Content-Length exceeds the cap, before parsing the body", async () => {
    const json = jest.fn(() => {
      throw new Error("body must not be parsed when Content-Length is over the cap")
    })
    const req = {
      headers: {
        get: (k: string) =>
          k === "content-length" ? String(200 * 1024) : k === "x-forwarded-for" ? `10.0.0.${++ipCounter}` : null,
      },
      json,
    } as unknown as NextRequest
    const res = await POST(req, { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(413)
    expect(json).not.toHaveBeenCalled()
  })

  it("returns 413 when Content-Length is absent (chunked Transfer-Encoding bypass)", async () => {
    const json = jest.fn(() => {
      throw new Error("body must not be parsed when Content-Length is missing")
    })
    const req = {
      headers: {
        get: (k: string) => (k === "x-forwarded-for" ? `10.0.0.${++ipCounter}` : null),
      },
      json,
    } as unknown as NextRequest
    const res = await POST(req, { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(413)
    expect(json).not.toHaveBeenCalled()
  })

  it("returns 400 for a malformed JSON body instead of crashing", async () => {
    const badBody = "{ invalid json"
    const req = new NextRequest("http://localhost/api/events/harvest/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(badBody)),
        "x-forwarded-for": `10.0.0.${++ipCounter}`,
      },
      body: badBody,
    })
    const res = await POST(req, { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Invalid request")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("encrypts email and phone before storing", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const createMock = jest.fn().mockResolvedValue({ id: 42 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: createMock }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
    await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", phone: "0400111222", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "enc:a@b.com", phone: "enc:0400111222" }) })
    )
  })

  it("stores the email blind index so the person-export can match it", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const createMock = jest.fn().mockResolvedValue({ id: 42 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: createMock }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
    await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "A@B.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailHash: "hash:a@b.com" }) })
    )
  })

  it("returns 429 after 10 requests from the same IP within a minute", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const body = { firstName: "A", lastName: "B", email: "a@b.com", tickets: {} }
    for (let i = 0; i < 10; i++) {
      const res = await POST(makeRequest(body, "10.99.99.99"), { params: Promise.resolve({ slug: "harvest" }) })
      expect(res.status).not.toBe(429)
    }
    const res = await POST(makeRequest(body, "10.99.99.99"), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(429)
  })

  // ---: bounded maps + answer-key validation ---

  it("returns 400 when a ticket quantity exceeds 100", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 2147483647 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when tickets map has more than 50 keys", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const tickets = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [String(i), 0]))
    const res = await POST(makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Too many ticket entries")
  })

  // a ticket type with capacity: null (unlimited) has no capacity check
  // to bound attendee count — only the per-type qty cap (100) and the map-key
  // cap (50) applied, letting one public POST request up to 5000 attendees.
  it("returns 400 when total attendees across all ticket types exceeds 100", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      ...mockEvent,
      ticketTypes: [
        { id: 1, name: "Adult", price: 45, capacity: null, registrationItems: [] },
        { id: 2, name: "Child", price: 20, capacity: null, registrationItems: [] },
      ],
    })
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 60, "2": 41 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("A single registration is limited to 100 attendees")
  })

  it("allows exactly 100 total attendees across ticket types with unlimited capacity", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      ...mockEvent,
      ticketTypes: [{ id: 1, name: "Adult", price: 45, capacity: null, registrationItems: [] }],
    })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) },
        registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 1, publicToken: "tok" }) },
        registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() },
      })
    )
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 100 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
  })

  it("returns 400 when customAnswers map has more than 50 keys", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const customAnswers = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`q${i}`, "x"]))
    const res = await POST(makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 }, customAnswers }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Too many answers")
  })

  it("returns 400 when a customAnswer key does not match a real question id", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      ...mockEvent,
      customQuestions: [{ id: "q1", label: "Diet", type: "text", required: false }],
    })
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 }, customAnswers: { bogus: "x" } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Unknown question")
  })

  it("accepts customAnswers keyed to real question ids", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      ...mockEvent,
      customQuestions: [{ id: "q1", label: "Diet", type: "text", required: false }],
    })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 7 }) }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 }, customAnswers: { q1: "vegan" } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
  })

  it("encrypts customAnswers at rest as a serialized JSON string", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      ...mockEvent,
      customQuestions: [{ id: "q1", label: "Diet", type: "text", required: false }],
    })
    const createMock = jest.fn().mockResolvedValue({ id: 7, publicToken: "tok" })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: createMock }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 }, customAnswers: { q1: "vegan" } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
    // mocked encrypt() = `enc:${v}` — stored value is the encrypted serialized map.
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customAnswers: `enc:${JSON.stringify({ q1: "vegan" })}` }),
      })
    )
  })

  it("stores undefined customAnswers when none submitted — no empty ciphertext", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const createMock = jest.fn().mockResolvedValue({ id: 8, publicToken: "tok" })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: createMock }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customAnswers: undefined }) })
    )
  })

  // ---: TOCTOU oversell ---

  const cappedEvent = {
    id: 1,
    isPublished: true,
    // outer pre-check passes (9 sold of 10, requesting 1), but a concurrent
    // registration filled the last seat — only the in-txn re-check catches it
    ticketTypes: [
      { id: 1, name: "Adult", price: 45, capacity: 10, registrationItems: [{ quantity: 9 }] },
    ],
    customQuestions: null,
  }

  it("re-validates capacity inside the transaction and rejects oversell (sold out)", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(cappedEvent)
    const itemCreate = jest.fn()
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({
        registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 99 }) },
        registrationItem: {
          create: itemCreate,
          aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 10 } }), // last seat taken
        },
        ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: 10 }) },
      })
    )
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(400)
    expect(itemCreate).not.toHaveBeenCalled()
  })

  it("excludes CANCELLED registrations from the in-txn capacity re-check", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(cappedEvent)
    const aggregate = jest.fn().mockResolvedValue({ _sum: { quantity: 9 } }) // 1 seat free
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({
        registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 100 }) },
        registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate },
        ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: 10 }) },
      })
    )
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
    // The authoritative aggregate must scope out CANCELLED holds.
    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ticketTypeId: 1,
          registration: { paymentStatus: { not: "CANCELLED" } },
        }),
      })
    )
  })

  it("loads sold-capacity items scoped to non-CANCELLED registrations", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(cappedEvent)
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({
        registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 101 }) },
        registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 9 } }) },
        ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: 10 }) },
      })
    )
    await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    const includeArg = (prisma.event.findUnique as jest.Mock).mock.calls[0][0].include
    expect(includeArg.ticketTypes.include.registrationItems.where).toEqual({
      registration: { paymentStatus: { not: "CANCELLED" } },
    })
  })

  it("never blocks registration when capacity is null (unlimited), even past typical caps", async () => {
    // capacity: null = unlimited. A large existing sold count + a large request
    // must still succeed — the in-txn capacity re-check is skipped for null.
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      ...mockEvent,
      ticketTypes: [{ id: 1, name: "Adult", price: 45, capacity: null, registrationItems: [{ quantity: 9999 }] }],
    })
    const itemCreate = jest.fn().mockResolvedValue({ id: 1 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) },
        registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 1, publicToken: "REG-UNLIMITED01" }) },
        registrationItem: { create: itemCreate, aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 9999 } }) },
      })
    )
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 100 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
    expect(itemCreate).toHaveBeenCalled()
  })

  it("runs the registration transaction at Serializable isolation", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 42 }) }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
    await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect((prisma.$transaction as jest.Mock).mock.calls[0][1]).toMatchObject({
      isolationLevel: "Serializable",
    })
  })

  it("returns 409 when the transaction keeps hitting serialization conflicts (P2034)", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const conflict = Object.assign(new Error("write conflict"), { code: "P2034" })
    ;(prisma.$transaction as jest.Mock).mockRejectedValue(conflict)
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(409)
  })

  it("retries on a transient serialization conflict then succeeds", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const conflict = Object.assign(new Error("write conflict"), { code: "P2034" })
    ;(prisma.$transaction as jest.Mock)
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (fn: (client: unknown) => Promise<unknown>) =>
        fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 7, publicToken: "REG-CCCCCCCCCCCC" }) }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
      )
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
    expect((await res.json()).ref).toBe("REG-CCCCCCCCCCCC")
  })

  // --- attendee names ---

  it("returns 400 when attendee name count does not match ticket quantity", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 2 }, attendeeNames: { "1": ["Only One"] } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/name for each/i)
  })

  it("returns 400 when an attendee name is whitespace-only", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 }, attendeeNames: { "1": ["   "] } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(400)
  })

  it("persists trimmed attendee names onto the created items via nested attendees.create", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    const itemCreate = jest.fn().mockResolvedValue({ id: 1 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 1, publicToken: "REG-OK" }) }, registrationItem: { create: itemCreate, aggregate: jest.fn() } })
    )
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 2 }, attendeeNames: { "1": ["  Alice Garcia ", "Bob Garcia"] } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
    const attendeesCreate = itemCreate.mock.calls[0][0].data.attendees.create as { name: string }[]
    expect(attendeesCreate.map((a) => a.name)).toEqual(["Alice Garcia", "Bob Garcia"])
  })

  // --- per-type answer validation + consent stamping ---

  const eventWithQ = {
    ...mockEvent,
    customQuestions: [
      { id: "q0", label: "Meal", type: "checkbox", required: true, options: ["Veg", "Non-veg"] },
      { id: "q1", label: "Waiver", type: "consent", required: true, body: "Terms" },
    ],
  }

  it("rejects checkbox answer not in options", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(eventWithQ)
    const res = await POST(makeRequest({
      firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 },
      customAnswers: { q0: ["Chicken"], q1: true },
    }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Invalid option: Meal")
  })

  it("blocks when required consent not checked", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(eventWithQ)
    const res = await POST(makeRequest({
      firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 },
      customAnswers: { q0: ["Veg"], q1: false },
    }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Answer required: Waiver")
  })

  it("stores normalized answers incl consent timestamp", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(eventWithQ)
    const createMock = jest.fn().mockResolvedValue({ id: 7, publicToken: "REG-X" })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) },
        registrationItem: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }), create: jest.fn().mockResolvedValue({ id: 1 }) },
        registration: { findFirst: jest.fn().mockResolvedValue(null), create: createMock },
      })
    )
    const res = await POST(makeRequest({
      firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 },
      customAnswers: { q0: ["Veg", "Non-veg"], q1: true },
    }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(200)
    // customAnswers persisted as encrypt(JSON.stringify(normalized)); crypto mock prefixes "enc:"
    // consent is replaced by an ISO timestamp; assert shape of the stored value.
    const storedCustomAnswers: string = createMock.mock.calls[0][0].data.customAnswers
    expect(storedCustomAnswers).toMatch(/^enc:/)
    const inner = storedCustomAnswers.slice(4) // strip "enc:" prefix
    const parsed = JSON.parse(inner) as Record<string, unknown>
    expect(parsed["q0"]).toEqual(["Veg", "Non-veg"])
    expect(typeof parsed["q1"]).toBe("string")
    expect(parsed["q1"]).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  const eventWithStatementsQ = {
    ...mockEvent,
    customQuestions: [
      { id: "q0", label: "C", type: "consent", required: true, statements: ["a", "b"] },
    ],
  }

  it("registers when a statements-consent array is all true (stores timestamp)", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(eventWithStatementsQ)
    const createMock = jest.fn().mockResolvedValue({ id: 7, publicToken: "REG-X" })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) },
        registrationItem: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }), create: jest.fn().mockResolvedValue({ id: 1 }) },
        registration: { findFirst: jest.fn().mockResolvedValue(null), create: createMock },
      })
    )
    const res = await POST(makeRequest({
      firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 },
      customAnswers: { q0: [true, true, true] },
    }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(200)
    const storedCustomAnswers: string = createMock.mock.calls[0][0].data.customAnswers
    expect(storedCustomAnswers).toMatch(/^enc:/)
    const parsed = JSON.parse(storedCustomAnswers.slice(4)) as Record<string, unknown>
    expect(typeof parsed["q0"]).toBe("string")
    expect(parsed["q0"]).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it("rejects when a required statements-consent array is incomplete", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(eventWithStatementsQ)
    const res = await POST(makeRequest({
      firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 },
      customAnswers: { q0: [true, false, true] },
    }), { params: Promise.resolve({ slug: "harvest" }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Answer required: C")
  })
})

describe("POST /api/events/[slug]/register — bot protection", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 1, publicToken: "REG-OK" }) }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
  })

  const base = { firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }
  const params = { params: Promise.resolve({ slug: "harvest" }) }

  it("rejects a filled honeypot with a generic 400 (no transaction)", async () => {
    const res = await POST(makeRequest({ ...base, formToken: validToken(), website: "http://spam.example" }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Registration failed")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("allows a blank/whitespace honeypot", async () => {
    const res = await POST(makeRequest({ ...base, formToken: validToken(), website: "   " }), params)
    expect(res.status).toBe(200)
  })

  it("rejects a missing form token", async () => {
    // Override the helper default with an explicit empty token.
    const res = await POST(makeRequest({ ...base, formToken: "" }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/refresh/i)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects a forged token signature", async () => {
    const res = await POST(makeRequest({ ...base, formToken: `${Date.now() - 5000}.forgedsig` }), params)
    expect(res.status).toBe(400)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects a submission faster than the 3s timing trap", async () => {
    const res = await POST(makeRequest({ ...base, formToken: issueFormToken(Date.now() - 500) }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Registration failed")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects a stale token older than the 2h max age", async () => {
    const res = await POST(makeRequest({ ...base, formToken: issueFormToken(Date.now() - 3 * 60 * 60 * 1000) }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/refresh/i)
  })

  it("accepts a valid, appropriately-aged token with an empty honeypot", async () => {
    const res = await POST(makeRequest({ ...base, formToken: validToken() }), params)
    expect(res.status).toBe(200)
  })

  it("rejects with a generic 400 when Turnstile is enabled but no token is supplied", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sk"
    try {
      const res = await POST(makeRequest({ ...base, formToken: validToken() }), params)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe("Registration failed")
      expect(prisma.$transaction).not.toHaveBeenCalled()
    } finally {
      delete process.env.TURNSTILE_SECRET_KEY
    }
  })

  it("accepts when Turnstile is disabled (default) with no token", async () => {
    // Guards the off-by-default contract: unset secret must not gate registration.
    const res = await POST(makeRequest({ ...base, formToken: validToken() }), params)
    expect(res.status).toBe(200)
  })
})

describe("POST /api/events/[slug]/register — per-attendee answers", () => {
  const ctx = { params: Promise.resolve({ slug: "harvest" }) }

  // Event with one attendee-scoped question and one order-scoped question
  const eventWithMixedQ = {
    id: 1,
    isPublished: true,
    ticketTypes: [
      { id: 1, name: "Adult", price: 20, capacity: null, registrationItems: [] },
    ],
    customQuestions: [
      { id: "qDiet", label: "Dietary", type: "select", required: false, options: ["None", "Vegan"], scope: "attendee" },
      { id: "qNotes", label: "Notes", type: "text", required: false, scope: "order" },
    ],
  }

  it("stores per-attendee answers on attendees, encrypted, separate from order answers", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(eventWithMixedQ)
    let capturedItemData: Record<string, unknown> | undefined
    const itemCreateMock = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
      capturedItemData = args.data
      return Promise.resolve({ id: 10 })
    })
    const regCreateMock = jest.fn().mockResolvedValue({ id: 5, publicToken: "REG-ATTEST01" })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) },
        registration: { findFirst: jest.fn().mockResolvedValue(null), create: regCreateMock },
        registrationItem: { create: itemCreateMock, aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }) },
      })
    )
    const res = await POST(
      makeRequest({
        firstName: "A", lastName: "B", email: "a@b.com",
        tickets: { "1": 2 },
        attendeeNames: { "1": ["Ann", "Bob"] },
        attendeeAnswers: { "1": [{ qDiet: "Vegan" }, { qDiet: "None" }] },
        customAnswers: { qNotes: "hi" },
      }),
      ctx,
    )
    expect(res.status).toBe(200)
    // Per-attendee answers stored encrypted on each Attendee row
    const attendeesCreate = capturedItemData?.attendees as { create: { name: string; answers: string | null }[] }
    expect(attendeesCreate.create.map((a) => a.name).sort()).toEqual(["Ann", "Bob"])
    expect(attendeesCreate.create.find((a) => a.name === "Ann")!.answers).toBe('enc:{"qDiet":"Vegan"}')
    expect(attendeesCreate.create.find((a) => a.name === "Bob")!.answers).toBe('enc:{"qDiet":"None"}')
    // Order-scoped answer stays on Registration.customAnswers
    expect(regCreateMock.mock.calls[0][0].data.customAnswers).toBe('enc:{"qNotes":"hi"}')
  })

  it("aligns per-attendee answers with names by original index when a blank name is filtered", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(eventWithMixedQ)
    let capturedItemData: Record<string, unknown> | undefined
    const itemCreateMock = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
      capturedItemData = args.data
      return Promise.resolve({ id: 10 })
    })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) },
        registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 5, publicToken: "REG-ALIGN01" }) },
        registrationItem: { create: itemCreateMock, aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }) },
      })
    )
    // A blank middle name is dropped (2 valid names == quantity 2), but the
    // answers array is parallel to the UNFILTERED names, so Bob's answers live at
    // index 2. Pre- the code read index 1 (the blank slot) → wrong person.
    const res = await POST(
      makeRequest({
        firstName: "A", lastName: "B", email: "a@b.com",
        tickets: { "1": 2 },
        attendeeNames: { "1": ["Ann", "   ", "Bob"] },
        attendeeAnswers: { "1": [{ qDiet: "Vegan" }, { qDiet: "Vegan" }, { qDiet: "None" }] },
      }),
      ctx,
    )
    expect(res.status).toBe(200)
    const attendeesCreate = capturedItemData?.attendees as { create: { name: string; answers: string | null }[] }
    expect(attendeesCreate.create.find((a) => a.name === "Ann")!.answers).toBe('enc:{"qDiet":"Vegan"}')
    // Bob must get index-2 ("None"), not the filtered-out blank slot's index-1 ("Vegan").
    expect(attendeesCreate.create.find((a) => a.name === "Bob")!.answers).toBe('enc:{"qDiet":"None"}')
  })

  it("rejects when a required attendee-scoped question is unanswered for an attendee", async () => {
    const eventWithReqQ = {
      ...eventWithMixedQ,
      customQuestions: [
        { id: "qDiet", label: "Dietary", type: "select", required: true, options: ["None", "Vegan"], scope: "attendee" },
      ],
    }
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(eventWithReqQ)
    const res = await POST(
      makeRequest({
        firstName: "A", lastName: "B", email: "a@b.com",
        tickets: { "1": 2 },
        attendeeNames: { "1": ["Ann", "Bob"] },
        // Bob omits qDiet — required for attendee scope
        attendeeAnswers: { "1": [{ qDiet: "Vegan" }, {}] },
      }),
      ctx,
    )
    expect(res.status).toBe(400)
  })
})

describe("POST /api/events/[slug]/register — per-ticket question applicability", () => {
  const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })

  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 1, publicToken: "REG-OK" }) }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
  })

  it("does not require a ticket-targeted question when its ticket is not selected", async () => {
    // Event: Adult(id1), Child(id2); required question targets Child only.
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      ...mockEvent,
      ticketTypes: [
        { id: 1, name: "Adult", price: 10, capacity: null, registrationItems: [] },
        { id: 2, name: "Child", price: 5, capacity: null, registrationItems: [] },
      ],
      customQuestions: [{ id: "q0", label: "Child age", type: "number", required: true, ticketTypeNames: ["Child"] }],
    })
    // Register only Adult ticket — required Child question should not block
    const res = await POST(makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 } }), ctx("x"))
    expect(res.status).toBe(200)
  })

  it("drops an answer for a non-applicable question", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      ...mockEvent,
      ticketTypes: [
        { id: 1, name: "Adult", price: 10, capacity: null, registrationItems: [] },
        { id: 2, name: "Child", price: 5, capacity: null, registrationItems: [] },
      ],
      customQuestions: [{ id: "q0", label: "Child age", type: "number", required: false, ticketTypeNames: ["Child"] }],
    })
    const createMock = jest.fn().mockResolvedValue({ id: 1, publicToken: "REG-OK" })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) }, registration: { findFirst: jest.fn().mockResolvedValue(null), create: createMock }, registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() } })
    )
    // Send answer for q0 but only Adult ticket selected — answer should be dropped
    await POST(makeRequest({ firstName: "A", lastName: "B", email: "a@b.com", tickets: { "1": 1 }, customAnswers: { q0: "7" } }), ctx("x"))
    const created = createMock.mock.calls[0][0].data
    // customAnswers omitted (no applicable answers) → undefined
    expect(created.customAnswers).toBeUndefined()
  })
})

describe("POST /api/events/[slug]/register — confirmation email", () => {
  const richEvent = {
    id: 1,
    isPublished: true,
    title: "Parish Picnic",
    date: new Date("2999-07-15T09:30:00Z"),
    endDate: null,
    description: "Bring food",
    location: "Church Hall",
    bankBsb: "012-345",
    bankAccount: "12345678",
    ticketTypes: [{ id: 1, name: "Adult", price: 45, capacity: null, registrationItems: [] }],
    customQuestions: null,
  }

  const okTransaction = (publicToken: string) =>
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ ticketType: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) },
        registration: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 1, publicToken }) },
        registrationItem: { create: jest.fn().mockResolvedValue({ id: 1 }), aggregate: jest.fn() },
      })
    )

  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(richEvent)
  })

  it("sends the confirmation with payment reference and ics on success", async () => {
    okTransaction("REG-CONF01")
    const res = await POST(
      makeRequest({ firstName: "Jane", lastName: "Doe", email: "confirm-ok@x.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledTimes(1)
    const [to, data] = (sendRegistrationConfirmationEmail as jest.Mock).mock.calls[0]
    expect(to).toBe("confirm-ok@x.com")
    expect(data.payment.reference).toBe("REG-CONF01")
    expect(data.ics.filename).toBe("event.ics")
    expect(data.googleCalendarUrl).toContain("calendar.google.com")
  })

  it("omits the payment block for a free event (total = $0)", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      ...richEvent,
      ticketTypes: [{ id: 1, name: "Free", price: 0, capacity: null, registrationItems: [] }],
    })
    okTransaction("REG-FREE01")
    const res = await POST(
      makeRequest({ firstName: "Jane", lastName: "Doe", email: "confirm-free@x.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
    const [, data] = (sendRegistrationConfirmationEmail as jest.Mock).mock.calls[0]
    expect(data.payment).toBeUndefined()
  })

  it("sends no ics/calendar link for a recurring event with no date", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ ...richEvent, date: null, endDate: null })
    okTransaction("REG-RECUR1")
    const res = await POST(
      makeRequest({ firstName: "Jane", lastName: "Doe", email: "confirm-recur@x.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
    const [, data] = (sendRegistrationConfirmationEmail as jest.Mock).mock.calls[0]
    expect(data.ics).toBeUndefined()
    expect(data.googleCalendarUrl).toBeUndefined()
  })

  it("skips the send past 5 confirmations/hr to one recipient but still returns 200", async () => {
    okTransaction("REG-BOMB")
    // 6 registrations to the SAME recipient from unique IPs (avoids the per-IP
    // 429). The recipient-keyed limiter allows 5/hr, so the 6th send is skipped.
    let last: Response | undefined
    for (let i = 0; i < 6; i++) {
      last = await POST(
        makeRequest({ firstName: "A", lastName: "B", email: "victim@x.com", tickets: { "1": 1 } }),
        { params: Promise.resolve({ slug: "harvest" }) }
      )
    }
    expect(last!.status).toBe(200)
    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledTimes(5)
  })

  it("still returns 200 when the confirmation send throws (fire-and-forget)", async () => {
    okTransaction("REG-THROW1")
    ;(sendRegistrationConfirmationEmail as jest.Mock).mockRejectedValueOnce(new Error("smtp down"))
    const res = await POST(
      makeRequest({ firstName: "A", lastName: "B", email: "thrower@x.com", tickets: { "1": 1 } }),
      { params: Promise.resolve({ slug: "harvest" }) }
    )
    expect(res.status).toBe(200)
  })
})
