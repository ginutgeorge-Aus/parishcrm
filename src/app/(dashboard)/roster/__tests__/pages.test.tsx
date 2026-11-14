/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
  useRouter: () => ({}),
  unstable_rethrow: jest.fn(),
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { rosterService: { findMany: jest.fn(), findUnique: jest.fn() }, rosterRole: { findMany: jest.fn() } },
}))
jest.mock("@/components/roster/SlotCell", () => ({
  SlotCell: ({ slotId, open, assignments }: { slotId: number; open: number; assignments: { name: string; status: string }[] }) => (
    <div data-slot={slotId} data-open={open}>{assignments.map((a) => `${a.name}:${a.status}`).join("|")}</div>
  ),
}))
jest.mock("@/components/roster/AddSlotForm", () => ({
  AddSlotForm: ({ roles }: { roles: { name: string }[] }) => <div>{`addable:${roles.map((r) => r.name).join(",")}`}</div>,
}))

import RosterPage from "@/app/(dashboard)/roster/page"
import RosterServicePage from "@/app/(dashboard)/roster/[id]/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const p = prisma as unknown as {
  rosterService: { findMany: jest.Mock; findUnique: jest.Mock }
  rosterRole: { findMany: jest.Mock }
}
const as = (role?: string) => (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)
const sp = (o: { past?: string } = {}) => ({ searchParams: Promise.resolve(o) })
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const startsAt = new Date("2026-12-05T22:30:00.000Z") // Sun 6 Dec 2026 09:30 Sydney
const endsAt = new Date("2026-12-06T00:00:00.000Z")

beforeEach(() => {
  jest.clearAllMocks()
  as("OFFICE_ADMIN")
  p.rosterService.findMany.mockResolvedValue([])
  p.rosterRole.findMany.mockResolvedValue([])
})

describe("/roster", () => {
  it("redirects anonymous to login and non-staff home without querying", async () => {
    as()
    await expect(RosterPage(sp())).rejects.toThrow("NEXT_REDIRECT /login")
    for (const role of ["VIEWER", "AUDITOR", "EVENT_ORGANISER", "TEACHER"]) {
      as(role)
      await expect(RosterPage(sp())).rejects.toThrow("NEXT_REDIRECT /")
    }
    expect(p.rosterService.findMany).not.toHaveBeenCalled()
  })

  it("lists upcoming services with filled/needed per role, declined places not counted", async () => {
    p.rosterService.findMany.mockResolvedValue([{
      id: 2, title: "Sunday service", date: new Date("2026-12-06"), startsAt, endsAt, location: "Church",
      slots: [
        { id: 5, needed: 3, role: { name: "Reader" }, assignments: [{ status: "CONFIRMED" }, { status: "DECLINED" }] },
        { id: 6, needed: 1, role: { name: "Usher" }, assignments: [{ status: "PENDING" }] },
      ],
    }])
    const html = renderToStaticMarkup(await RosterPage(sp()))
    expect(p.rosterService.findMany.mock.calls[0][0].where.date).toHaveProperty("gte")
    expect(html).toContain('href="/roster/2"')
    expect(html).toContain("Sunday service")
    expect(html).toContain("Reader: 1/3")
    expect(html).toContain("Usher: 1/1")
    expect(html).toContain("Show past services")
  })

  it("shows past services newest first, and the empty states", async () => {
    const html = renderToStaticMarkup(await RosterPage(sp({ past: "1" })))
    expect(p.rosterService.findMany.mock.calls[0][0]).toMatchObject({ orderBy: { startsAt: "desc" }, where: { date: { lt: expect.any(Date) } } })
    expect(html).toContain("No past services.")
    expect(renderToStaticMarkup(await RosterPage(sp()))).toContain("No upcoming services.")
  })
})

describe("/roster/[id]", () => {
  const service = {
    id: 2, title: "Sunday service", startsAt, endsAt, location: "",
    slots: [{
      id: 5, needed: 2, roleId: 3, role: { name: "Reader" },
      assignments: [{ id: 11, status: "PENDING", person: { firstName: "Ann", lastName: "Lee" } }],
    }],
  }

  it("redirects non-staff and 404s a bad or unknown id", async () => {
    as("VIEWER")
    await expect(RosterServicePage(params("2"))).rejects.toThrow("NEXT_REDIRECT /")
    as("ADMIN")
    await expect(RosterServicePage(params("abc"))).rejects.toThrow("NEXT_NOT_FOUND")
    p.rosterService.findUnique.mockResolvedValue(null)
    await expect(RosterServicePage(params("2"))).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders the grid with open places and only the roles not yet added", async () => {
    p.rosterService.findUnique.mockResolvedValue(service)
    p.rosterRole.findMany.mockResolvedValue([{ id: 4, name: "Usher", defaultCount: 1 }])
    const html = renderToStaticMarkup(await RosterServicePage(params("2")))
    expect(html).toContain("Reader")
    expect(html).toContain("(1/2)")
    expect(html).toContain('data-slot="5" data-open="1"')
    expect(html).toContain("Ann Lee:PENDING")
    expect(html).toContain("addable:Usher")
    expect(p.rosterRole.findMany.mock.calls[0][0].where).toEqual({ archivedAt: null, id: { notIn: [3] } })
  })
})
