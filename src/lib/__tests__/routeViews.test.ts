/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: { routeViewDaily: { upsert: jest.fn(), groupBy: jest.fn() } },
}))
import { prisma } from "@/lib/prisma"
import { recordRouteView, getTopRoutes, normalizeRoute } from "@/lib/routeViews"

describe("routeViews", () => {
  beforeEach(() => jest.clearAllMocks())

  it("recordRouteView upserts with a day-truncated date and increments count", async () => {
    ;(prisma.routeViewDaily.upsert as jest.Mock).mockResolvedValue({})
    recordRouteView("/reports", new Date("2026-09-01T13:00:00.000Z"))
    await new Promise((r) => setImmediate(r))
    const arg = (prisma.routeViewDaily.upsert as jest.Mock).mock.calls[0][0]
    expect(arg.update).toEqual({ count: { increment: 1 } })
    expect(arg.create.route).toBe("/reports")
    expect((arg.where.route_date.date as Date).toISOString()).toBe("2026-09-01T00:00:00.000Z")
  })

  it("normalizeRoute templates numeric, uuid and cuid segments", () => {
    expect(normalizeRoute("/people/123")).toBe("/people/[id]")
    expect(normalizeRoute("/families/clh3x9k2a0000qzrmn831i7rn/edit")).toBe("/families/[id]/edit")
    expect(normalizeRoute("/events/123e4567-e89b-12d3-a456-426614174000")).toBe("/events/[id]")
    expect(normalizeRoute("/accounting/petty-cash/sessions/7/expenses/9")).toBe(
      "/accounting/petty-cash/sessions/[id]/expenses/[id]"
    )
    expect(normalizeRoute("/reports")).toBe("/reports")
    expect(normalizeRoute("/people/new")).toBe("/people/new")
    expect(normalizeRoute("/")).toBe("/")
  })

  it("recordRouteView stores the templated route for record pages", async () => {
    ;(prisma.routeViewDaily.upsert as jest.Mock).mockResolvedValue({})
    recordRouteView("/people/42", new Date("2026-09-01T13:00:00.000Z"))
    await new Promise((r) => setImmediate(r))
    const arg = (prisma.routeViewDaily.upsert as jest.Mock).mock.calls[0][0]
    expect(arg.where.route_date.route).toBe("/people/[id]")
    expect(arg.create.route).toBe("/people/[id]")
  })

  it("recordRouteView never throws on upsert failure", async () => {
    ;(prisma.routeViewDaily.upsert as jest.Mock).mockRejectedValue(new Error("x"))
    expect(() => recordRouteView("/a")).not.toThrow()
    await new Promise((r) => setImmediate(r))
  })

  it("getTopRoutes maps groupBy rows desc", async () => {
    ;(prisma.routeViewDaily.groupBy as jest.Mock).mockResolvedValue([
      { route: "/reports", _sum: { count: 40 } },
    ])
    expect(await getTopRoutes(30)).toEqual([{ route: "/reports", count: 40 }])
  })
})
