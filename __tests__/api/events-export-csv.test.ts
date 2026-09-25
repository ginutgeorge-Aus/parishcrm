/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/eventManager", () => ({ isEventManager: jest.fn() }))

import { GET } from "@/app/api/events/[slug]/export-csv/route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { isEventManager } from "@/lib/eventManager"
import { NextRequest } from "next/server"

const mockAuth = auth as jest.Mock
const mockFindUnique = prisma.event.findUnique as jest.Mock
const mockLogAudit = logAudit as jest.Mock
const mockIsEventManager = isEventManager as jest.Mock

function makeRequest() {
  return new NextRequest("http://localhost/api/events/summer-fair/export-csv")
}

function makeProps(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

const mockEvent = {
  id: 1,
  slug: "summer-fair",
  isPublished: true,
  customQuestions: null,
  registrations: [],
}

describe("GET /api/events/[slug]/export-csv", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindUnique.mockResolvedValue(mockEvent)
    mockIsEventManager.mockResolvedValue(true)
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest(), makeProps("summer-fair"))
    expect(res.status).toBe(401)
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("returns 403 for VIEWER", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "3" } })
    const res = await GET(makeRequest(), makeProps("summer-fair"))
    expect(res.status).toBe(403)
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("returns 400 for an empty slug", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await GET(makeRequest(), makeProps(""))
    expect(res.status).toBe(400)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it("looks up the event by slug, not by integer id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await GET(makeRequest(), makeProps("summer-fair"))
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "summer-fair" } })
    )
  })

  it("returns 404 when event not found", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue(null)
    const res = await GET(makeRequest(), makeProps("nope"))
    expect(res.status).toBe(404)
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("exports a draft (unpublished) event for an editor", async () => {
    // Route is auth-guarded by canEdit and resolves by slug, so the old
    // isPublished 404 only confused admins managing draft events — removed.
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ ...mockEvent, isPublished: false })
    const res = await GET(makeRequest(), makeProps("summer-fair"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/csv")
    expect(mockLogAudit).toHaveBeenCalledTimes(1)
  })

  it("returns 200 with text/csv content-type for ADMIN", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await GET(makeRequest(), makeProps("summer-fair"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/csv")
    expect(res.headers.get("content-disposition")).toContain("registrations-1.csv")
  })

  it("returns 200 for PASTOR (canEdit role)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "PASTOR", id: "2" } })
    const res = await GET(makeRequest(), makeProps("summer-fair"))
    expect(res.status).toBe(200)
  })

  it("calls logAudit with EXPORT_CSV and the resolved event id + rowCount", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ ...mockEvent, registrations: [] })
    const res = await GET(makeRequest(), makeProps("summer-fair"))
    expect(res.status).toBe(200)
    expect(mockLogAudit).toHaveBeenCalledTimes(1)
    expect(mockLogAudit).toHaveBeenCalledWith(
      1,
      "EXPORT_CSV",
      "Event",
      1,
      { rowCount: 0 },
      "unknown"
    )
  })

  it("CSV body contains the per-attendee column headers", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await GET(makeRequest(), makeProps("summer-fair"))
    const text = await res.text()
    expect(text).toContain("Ref,Attendee Name,Ticket Type,Registrant First,Registrant Last,Email")
  })

  const regWith = (customAnswers: unknown) => ({
    id: 1,
    firstName: "Ann",
    lastName: "Lee",
    email: "enc:a@b.com",
    phone: null,
    totalAmount: { toString: () => "0" },
    paymentStatus: "PAID",
    createdAt: new Date("2026-01-01"),
    customAnswers,
    items: [{ quantity: 1, ticketType: { name: "Adult" }, attendees: [] }],
  })

  it("decrypts the encrypted customAnswers JSON string into the CSV", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({
      ...mockEvent,
      customQuestions: [{ id: "q1", label: "Diet" }],
      registrations: [regWith(`enc:${JSON.stringify({ q1: "vegan" })}`)],
    })
    const text = await (await GET(makeRequest(), makeProps("summer-fair"))).text()
    expect(text).toContain("vegan")
  })

  it("still reads legacy plaintext-object customAnswers ( transition)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({
      ...mockEvent,
      customQuestions: [{ id: "q1", label: "Diet" }],
      registrations: [regWith({ q1: "vegan" })],
    })
    const text = await (await GET(makeRequest(), makeProps("summer-fair"))).text()
    expect(text).toContain("vegan")
  })

  it("checks per-event organiser ownership on a cheap lookup before the heavy registrations query", async () => {
    mockAuth.mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
    mockIsEventManager.mockResolvedValue(false)
    const res = await GET(makeRequest(), makeProps("summer-fair"))
    expect(res.status).toBe(403)
    expect(mockFindUnique).toHaveBeenCalledTimes(1)
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { slug: "summer-fair" }, select: { id: true } })
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("runs the full registrations query only after the organiser ownership check passes", async () => {
    mockAuth.mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
    mockIsEventManager.mockResolvedValue(true)
    const res = await GET(makeRequest(), makeProps("summer-fair"))
    expect(res.status).toBe(200)
    expect(mockFindUnique).toHaveBeenCalledTimes(2)
    expect(mockIsEventManager).toHaveBeenCalledWith(5, mockEvent.id)
  })

  it("degrades safely on null or corrupt customAnswers — empty answer column, no crash", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({
      ...mockEvent,
      customQuestions: [{ id: "q1", label: "Diet" }],
      // null = never answered; a non-`enc:`/non-JSON string = corrupt scalar
      // (safeDecrypt returns it unchanged, JSON.parse throws → null map).
      registrations: [regWith(null), regWith("not-json")],
    })
    const res = await GET(makeRequest(), makeProps("summer-fair"))
    expect(res.status).toBe(200)
    const lines = (await res.text()).split("\n")
    // header + one row per registration; each row's trailing Diet column is empty.
    expect(lines).toHaveLength(3)
    expect(lines[1].endsWith(",")).toBe(true)
    expect(lines[2].endsWith(",")).toBe(true)
  })
})
