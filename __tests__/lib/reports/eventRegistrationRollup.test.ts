/** @jest-environment node */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    registration: { groupBy: jest.fn(), aggregate: jest.fn() },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}))
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { RepeatableRead: "RepeatableRead" } },
}))

import { prisma } from "@/lib/prisma"
import { getEventRegistrationRollup } from "@/lib/reports/eventRegistrationRollup"

const mockGroupBy = prisma.registration.groupBy as jest.Mock
const mockAggregate = prisma.registration.aggregate as jest.Mock
const dec = (v: string) => ({ toString: () => v })

beforeEach(() => jest.clearAllMocks())

describe("getEventRegistrationRollup", () => {
  it("splits paid revenue into card (has paymentRef) and transfer (the rest)", async () => {
    mockGroupBy.mockResolvedValue([
      { paymentStatus: "PAID", _count: { _all: 3 }, _sum: { totalAmount: dec("150.30") } },
      { paymentStatus: "CANCELLED", _count: { _all: 1 }, _sum: { totalAmount: dec("20") } },
      { paymentStatus: "PENDING", _count: { _all: 2 }, _sum: { totalAmount: dec("40") } },
    ])
    mockAggregate.mockResolvedValue({ _sum: { totalAmount: dec("100.10") } })

    const rollup = await getEventRegistrationRollup(9)

    expect(mockAggregate).toHaveBeenCalledWith({
      where: { eventId: 9, paymentStatus: "PAID", paymentRef: { not: null } },
      _sum: { totalAmount: true },
    })
    expect(rollup).toEqual({ total: 6, paid: 3, cancelled: 1, revenue: 150.3, cardRevenue: 100.1, transferRevenue: 50.2 })
    // Both reads share one snapshot so card can never exceed total.
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array), { isolationLevel: "RepeatableRead" })
  })

  it("throws rather than render NaN when an aggregate exceeds the safe cents range", async () => {
    mockGroupBy.mockResolvedValue([
      { paymentStatus: "PAID", _count: { _all: 1 }, _sum: { totalAmount: dec("99999999999999999.00") } },
    ])
    mockAggregate.mockResolvedValue({ _sum: { totalAmount: null } })

    await expect(getEventRegistrationRollup(9)).rejects.toThrow("safe integer range")
  })

  it("returns zeros for an event with no registrations", async () => {
    mockGroupBy.mockResolvedValue([])
    mockAggregate.mockResolvedValue({ _sum: { totalAmount: null } })

    expect(await getEventRegistrationRollup(9)).toEqual({
      total: 0, paid: 0, cancelled: 0, revenue: 0, cardRevenue: 0, transferRevenue: 0,
    })
  })
})
