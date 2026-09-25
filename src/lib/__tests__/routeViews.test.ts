/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: { routeViewDaily: { upsert: jest.fn(), groupBy: jest.fn() } },
}))
import { prisma } from "@/lib/prisma"
import { recordRouteView, getTopRoutes } from "@/lib/routeViews"

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
