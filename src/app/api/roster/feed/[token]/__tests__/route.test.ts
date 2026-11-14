/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: { rosterFeedToken: { findUnique: jest.fn() }, rosterAssignment: { findMany: jest.fn() } },
}))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))

import { GET } from "@/app/api/roster/feed/[token]/route"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rateLimit"
import { hashRosterFeedToken, mintRosterFeedToken } from "@/lib/rosterFeed"

const p = prisma as unknown as {
  rosterFeedToken: { findUnique: jest.Mock }
  rosterAssignment: { findMany: jest.Mock }
}
const ctx = (token: string) => ({ params: Promise.resolve({ token }) })
const req = () => new Request("http://localhost/api/roster/feed/x")
const person = { id: 7, firstName: "Ann", lastName: "Lee", archivedAt: null as Date | null }

beforeEach(() => {
  jest.clearAllMocks()
  ;(rateLimit as jest.Mock).mockReturnValue(true)
  p.rosterAssignment.findMany.mockResolvedValue([])
})

describe("GET /api/roster/feed/[token]", () => {
  it("404s a malformed token without touching the DB", async () => {
    const res = await GET(req(), ctx("bad"))
    expect(res.status).toBe(404)
    expect(p.rosterFeedToken.findUnique).not.toHaveBeenCalled()
  })

  it("404s an unknown or rotated token", async () => {
    p.rosterFeedToken.findUnique.mockResolvedValue(null)
    const res = await GET(req(), ctx(mintRosterFeedToken()))
    expect(res.status).toBe(404)
    expect(p.rosterAssignment.findMany).not.toHaveBeenCalled()
  })

  it("404s when the stored hash does not match the token", async () => {
    p.rosterFeedToken.findUnique.mockResolvedValue({ tokenHash: hashRosterFeedToken("other"), person })
    expect((await GET(req(), ctx(mintRosterFeedToken()))).status).toBe(404)
  })

  it("404s an archived person", async () => {
    const t = mintRosterFeedToken()
    p.rosterFeedToken.findUnique.mockResolvedValue({ tokenHash: hashRosterFeedToken(t), person: { ...person, archivedAt: new Date() } })
    expect((await GET(req(), ctx(t))).status).toBe(404)
  })

  it("429s when rate limited", async () => {
    ;(rateLimit as jest.Mock).mockReturnValue(false)
    const res = await GET(req(), ctx(mintRosterFeedToken()))
    expect(res.status).toBe(429)
    expect(p.rosterFeedToken.findUnique).not.toHaveBeenCalled()
  })

  it("serves the person's calendar for a good token, with or without .ics", async () => {
    const t = mintRosterFeedToken()
    p.rosterFeedToken.findUnique.mockResolvedValue({ tokenHash: hashRosterFeedToken(t), person })
    p.rosterAssignment.findMany.mockResolvedValue([{
      id: 11,
      status: "CONFIRMED",
      slot: {
        role: { name: "Reader" },
        service: { title: "Sunday service", startsAt: new Date("2026-11-22T22:30:00Z"), endsAt: new Date("2026-11-23T00:00:00Z"), location: "Church" },
      },
    }])
    for (const raw of [t, `${t}.ics`]) {
      const res = await GET(req(), ctx(raw))
      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toContain("text/calendar")
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
      const body = await res.text()
      expect(body).toContain("BEGIN:VCALENDAR")
      expect(body).toContain("SUMMARY:Sunday service (Reader)")
      expect(body).toContain("UID:11@")
      expect(body).not.toContain(t)
    }
    expect(p.rosterAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ personId: 7, status: { not: "DECLINED" } }),
    }))
  })
})
