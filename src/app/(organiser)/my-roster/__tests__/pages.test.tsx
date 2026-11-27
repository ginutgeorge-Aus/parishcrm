/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { rosterService: { findMany: jest.fn(), findUnique: jest.fn() } },
}))
jest.mock("@/components/roster/SlotCell", () => ({
  SlotCell: ({ slotId }: { slotId: number }) => <div>slot-{slotId}</div>,
}))

import MyRosterPage from "@/app/(organiser)/my-roster/page"
import MyRosterServicePage from "@/app/(organiser)/my-roster/[id]/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const p = prisma as unknown as { rosterService: { findMany: jest.Mock; findUnique: jest.Mock } }
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const LED = { archivedAt: null, group: { archivedAt: null, leaderAccess: { some: { userId: 5 } } } }
const when = new Date("2026-12-06T23:00:00Z")

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "EVENT_ORGANISER" } })
})

describe("/my-roster", () => {
  it("redirects a non-organiser (stale link row) before any read", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "VIEWER" } })
    await expect(MyRosterPage()).rejects.toThrow("NEXT_REDIRECT /")
    expect(p.rosterService.findMany).not.toHaveBeenCalled()
  })

  it("redirects a signed-out caller to login", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    await expect(MyRosterPage()).rejects.toThrow("NEXT_REDIRECT /login")
  })

  it("queries only roles in live groups this login leads", async () => {
    p.rosterService.findMany.mockResolvedValue([
      { id: 9, title: "Sunday Service", startsAt: when, endsAt: when, location: "", slots: [{ id: 1, needed: 2, role: { name: "Readers" }, assignments: [{ status: "PENDING" }] }] },
    ])
    const html = renderToStaticMarkup(await MyRosterPage())
    const arg = p.rosterService.findMany.mock.calls[0][0]
    expect(arg.where.slots).toEqual({ some: { role: LED } })
    expect(arg.select.slots.where).toEqual({ role: LED })
    expect(html).toContain("Readers: 1/2")
    expect(html).toContain("/my-roster/9")
  })

  it("shows the empty notice for a leader with no roles", async () => {
    p.rosterService.findMany.mockResolvedValue([])
    expect(renderToStaticMarkup(await MyRosterPage())).toContain("No upcoming services need people")
  })
})

describe("/my-roster/[id]", () => {
  it("404s a leader on an unlinked role (service has no slot they lead)", async () => {
    p.rosterService.findUnique.mockResolvedValue({ id: 9, title: "S", startsAt: when, endsAt: when, location: "", slots: [] })
    await expect(MyRosterServicePage(params("9"))).rejects.toThrow("NEXT_NOT_FOUND")
    expect(p.rosterService.findUnique.mock.calls[0][0].select.slots.where).toEqual({ role: LED })
  })

  it("404s a missing service and a bad id", async () => {
    p.rosterService.findUnique.mockResolvedValue(null)
    await expect(MyRosterServicePage(params("9"))).rejects.toThrow("NEXT_NOT_FOUND")
    await expect(MyRosterServicePage(params("abc"))).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("redirects a non-organiser before reading", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "VIEWER" } })
    await expect(MyRosterServicePage(params("9"))).rejects.toThrow("NEXT_REDIRECT /")
    expect(p.rosterService.findUnique).not.toHaveBeenCalled()
  })

  it("renders only the led slots", async () => {
    p.rosterService.findUnique.mockResolvedValue({
      id: 9, title: "Sunday Service", startsAt: when, endsAt: when, location: "",
      slots: [{ id: 4, needed: 1, role: { name: "Readers" }, assignments: [{ id: 2, status: "PENDING", person: { firstName: "Jo", lastName: "Doe" } }] }],
    })
    const html = renderToStaticMarkup(await MyRosterServicePage(params("9")))
    expect(html).toContain("Readers")
    expect(html).toContain("slot-4")
  })
})
