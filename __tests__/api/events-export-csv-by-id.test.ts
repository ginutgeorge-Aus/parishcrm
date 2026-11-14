/** @jest-environment node */

jest.mock("@/lib/featureFlags")
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { event: { findUnique: jest.fn() } } }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v) }))
jest.mock("@/lib/eventManager", () => ({ isEventManager: jest.fn() }))

import { GET } from "@/app/api/event-exports/[id]/csv/route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isEventManager } from "@/lib/eventManager"
import { NextRequest } from "next/server"

const mockAuth = auth as jest.Mock
const mockFindUnique = prisma.event.findUnique as jest.Mock
const req = () => new NextRequest("http://localhost/api/event-exports/5/csv")
const props = (id: string) => ({ params: Promise.resolve({ id }) })

describe("GET /api/event-exports/[id]/csv (slugless events)", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindUnique.mockResolvedValue({ id: 5, slug: null, customQuestions: null, registrations: [] })
    ;(isEventManager as jest.Mock).mockResolvedValue(false)
  })

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(req(), props("5"))).status).toBe(401)
  })
  it("403 for VIEWER", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "3" } })
    expect((await GET(req(), props("5"))).status).toBe(403)
  })
  it("400 for a non-numeric id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    expect((await GET(req(), props("abc"))).status).toBe(400)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })
  it("403 for an organiser who does not manage the event", async () => {
    mockAuth.mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "9" } })
    expect((await GET(req(), props("5"))).status).toBe(403)
  })
  it("200 CSV for an editor, looked up by id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await GET(req(), props("5"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/csv")
    expect(mockFindUnique.mock.calls[0][0].where).toEqual({ id: 5 })
  })
})
