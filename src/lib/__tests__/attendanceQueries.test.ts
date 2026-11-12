/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    serviceHeadcount: { findMany: jest.fn() },
    serviceType: { findMany: jest.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import {
  getActiveServiceTypes,
  getAllServiceTypes,
  getHeadcountRows,
  getRecentHeadcounts,
} from "../attendanceQueries"

const p = prisma as unknown as {
  serviceHeadcount: { findMany: jest.Mock }
  serviceType: { findMany: jest.Mock }
}

beforeEach(() => jest.clearAllMocks())

describe("getHeadcountRows", () => {
  it("queries an inclusive UTC date range and maps dates to YYYY-MM-DD", async () => {
    p.serviceHeadcount.findMany.mockResolvedValue([
      { serviceDate: new Date("2026-11-08T00:00:00.000Z"), serviceTypeId: 2, adults: 5, children: 0 },
    ])
    const rows = await getHeadcountRows("2026-11-01", "2026-11-30")
    expect(rows).toEqual([{ date: "2026-11-08", serviceTypeId: 2, adults: 5, children: 0 }])
    const arg = p.serviceHeadcount.findMany.mock.calls[0][0]
    expect(arg.where.serviceDate).toEqual({
      gte: new Date("2026-11-01T00:00:00.000Z"),
      lte: new Date("2026-11-30T00:00:00.000Z"),
    })
    expect(arg.select).toEqual({ serviceDate: true, serviceTypeId: true, adults: true, children: true })
  })
})

describe("getRecentHeadcounts", () => {
  it("returns newest first with the service type name", async () => {
    p.serviceHeadcount.findMany.mockResolvedValue([
      {
        id: 4, serviceDate: new Date("2026-11-08T00:00:00.000Z"), serviceTypeId: 2,
        adults: 5, children: 1, notes: null, serviceType: { name: "Sunday" },
      },
    ])
    const rows = await getRecentHeadcounts(20)
    expect(rows).toEqual([
      { id: 4, date: "2026-11-08", serviceTypeId: 2, serviceTypeName: "Sunday", adults: 5, children: 1, notes: null },
    ])
    const arg = p.serviceHeadcount.findMany.mock.calls[0][0]
    expect(arg.take).toBe(20)
    expect(arg.orderBy).toEqual([{ serviceDate: "desc" }, { serviceTypeId: "asc" }])
  })
})

describe("service type lists", () => {
  it("active list filters isActive and sorts by name", async () => {
    p.serviceType.findMany.mockResolvedValue([{ id: 1, name: "A" }])
    expect(await getActiveServiceTypes()).toEqual([{ id: 1, name: "A" }])
    expect(p.serviceType.findMany.mock.calls[0][0].where).toEqual({ isActive: true })
  })

  it("all list includes inactive types", async () => {
    p.serviceType.findMany.mockResolvedValue([{ id: 1, name: "A" }])
    await getAllServiceTypes()
    expect(p.serviceType.findMany.mock.calls[0][0].where).toBeUndefined()
  })
})
