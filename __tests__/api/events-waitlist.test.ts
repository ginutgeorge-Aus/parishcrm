/** @jest-environment node */
import { POST } from "@/app/api/events/[slug]/waitlist/route"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma/client"
import { NextRequest } from "next/server"
import { verifyTurnstile } from "@/lib/turnstile"

jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
    registrationItem: { aggregate: jest.fn() },
    waitlist: { create: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  hmacEmail: jest.fn((v: string) => `hash:${v}`),
}))
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => true),
}))
jest.mock("@/lib/formToken", () => ({
  verifyFormToken: jest.fn(() => "ok"),
}))
jest.mock("@/lib/turnstile", () => ({
  verifyTurnstile: jest.fn(() => Promise.resolve(true)),
}))

const req = (body: object) =>
  new NextRequest("http://localhost/api/events/camp/waitlist", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "x-forwarded-for": "1.1.1.1",
      "content-length": String(Buffer.byteLength(JSON.stringify(body))),
    },
  })

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })

describe("POST /api/events/[slug]/waitlist", () => {
  beforeEach(() => jest.clearAllMocks())

  // Sold-out ticket type: capacity 5, 5 already sold → waitlist allowed.
  const soldOut = () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      id: 1, isPublished: true, date: null, endDate: null,
      ticketTypes: [{ id: 7, capacity: 5 }],
    })
    ;(prisma.registrationItem.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 5 } })
  }

  it("creates an encrypted waitlist row for a valid join", async () => {
    soldOut()
    ;(prisma.waitlist.create as jest.Mock).mockResolvedValue({ id: 1 })
    const res = await POST(req({ ticketTypeId: 7, name: "Ann", email: "a@b.com", formToken: "t" }), ctx("camp"))
    expect(res.status).toBe(200)
    expect(prisma.waitlist.create).toHaveBeenCalledWith({
      data: { eventId: 1, ticketTypeId: 7, name: "Ann", email: "enc:a@b.com", emailHash: "hash:a@b.com" },
    })
  })

  it("treats a duplicate join (P2002) as success without erroring", async () => {
    soldOut()
    ;(prisma.waitlist.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }),
    )
    const res = await POST(req({ ticketTypeId: 7, name: "Ann", email: "a@b.com", formToken: "t" }), ctx("camp"))
    expect(res.status).toBe(200)
  })

  it("rejects an unknown ticket type with 400", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, isPublished: true, date: null, endDate: null, ticketTypes: [{ id: 7 }] })
    const res = await POST(req({ ticketTypeId: 999, name: "Ann", email: "a@b.com", formToken: "t" }), ctx("camp"))
    expect(res.status).toBe(400)
    expect(prisma.waitlist.create).not.toHaveBeenCalled()
  })

  it("rejects a join for a ticket type that still has seats", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      id: 1, isPublished: true, date: null, endDate: null, ticketTypes: [{ id: 7, capacity: 5 }],
    })
    ;(prisma.registrationItem.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 3 } })
    const res = await POST(req({ ticketTypeId: 7, name: "Ann", email: "a@b.com", formToken: "t" }), ctx("camp"))
    expect(res.status).toBe(400)
    expect(prisma.waitlist.create).not.toHaveBeenCalled()
  })

  it("rejects a join for an unlimited ticket type", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      id: 1, isPublished: true, date: null, endDate: null, ticketTypes: [{ id: 7, capacity: null }],
    })
    ;(prisma.registrationItem.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 100 } })
    const res = await POST(req({ ticketTypeId: 7, name: "Ann", email: "a@b.com", formToken: "t" }), ctx("camp"))
    expect(res.status).toBe(400)
    expect(prisma.waitlist.create).not.toHaveBeenCalled()
  })

  it("rejects a failed Turnstile check with 400 and no insert", async () => {
    soldOut()
    ;(verifyTurnstile as jest.Mock).mockResolvedValueOnce(false)
    const res = await POST(req({ ticketTypeId: 7, name: "Ann", email: "a@b.com", formToken: "t", turnstileToken: "bad" }), ctx("camp"))
    expect(res.status).toBe(400)
    expect(prisma.waitlist.create).not.toHaveBeenCalled()
  })

  it("rejects a filled honeypot with 400 and no insert", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, isPublished: true, date: null, endDate: null, ticketTypes: [{ id: 7 }] })
    const res = await POST(req({ ticketTypeId: 7, name: "Ann", email: "a@b.com", website: "bot", formToken: "t" }), ctx("camp"))
    expect(res.status).toBe(400)
    expect(prisma.waitlist.create).not.toHaveBeenCalled()
  })

  it("returns 400 for a malformed JSON body instead of crashing", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      id: 1, isPublished: true, date: null, endDate: null, ticketTypes: [{ id: 7 }],
    })
    const badBody = "{ invalid json"
    const res = await POST(
      new NextRequest("http://localhost/api/events/camp/waitlist", {
        method: "POST",
        body: badBody,
        headers: {
          "x-forwarded-for": "1.1.1.1",
          "content-length": String(Buffer.byteLength(badBody)),
        },
      }),
      ctx("camp"),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Invalid request")
    expect(prisma.waitlist.create).not.toHaveBeenCalled()
  })

  it("404 for unpublished event", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, isPublished: false, date: null, endDate: null, ticketTypes: [] })
    const res = await POST(req({ ticketTypeId: 7, name: "Ann", email: "a@b.com", formToken: "t" }), ctx("camp"))
    expect(res.status).toBe(404)
  })

  it("400 Registration for this event is closed when registrationClosed is true (distinct from the 404 unpublished/past events use)", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      id: 1, isPublished: true, date: new Date("2999-01-01"), endDate: null,
      registrationClosed: true, registrationDeadline: null,
      ticketTypes: [{ id: 7, capacity: 5 }],
    })
    const res = await POST(req({ ticketTypeId: 7, name: "Ann", email: "a@b.com", formToken: "t" }), ctx("camp"))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Registration for this event is closed.")
    expect(prisma.waitlist.create).not.toHaveBeenCalled()
  })

  it("400 Registration for this event is closed when registrationDeadline has passed", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      id: 1, isPublished: true, date: new Date("2999-01-01"), endDate: null,
      registrationClosed: false, registrationDeadline: new Date("2000-01-01"),
      ticketTypes: [{ id: 7, capacity: 5 }],
    })
    const res = await POST(req({ ticketTypeId: 7, name: "Ann", email: "a@b.com", formToken: "t" }), ctx("camp"))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Registration for this event is closed.")
    expect(prisma.waitlist.create).not.toHaveBeenCalled()
  })
})
