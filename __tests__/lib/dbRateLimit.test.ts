/** @jest-environment node */
import { prisma } from "@/lib/prisma"
import { dbRateLimit } from "@/lib/dbRateLimit"

jest.mock("@/lib/prisma", () => ({
  prisma: {
    rateLimit: {
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  },
}))

const mockDelete = prisma.rateLimit.deleteMany as jest.Mock
const mockUpdate = prisma.rateLimit.updateMany as jest.Mock
const mockCreate = prisma.rateLimit.create as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockDelete.mockResolvedValue({ count: 0 })
})

describe("dbRateLimit", () => {
  it("allows when an active under-limit row is incremented", async () => {
    mockUpdate.mockResolvedValue({ count: 1 })
    expect(await dbRateLimit("k", 5, 1000)).toBe(true)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("allows by creating a fresh row when none exists", async () => {
    mockUpdate.mockResolvedValue({ count: 0 })
    mockCreate.mockResolvedValue({})
    expect(await dbRateLimit("k", 5, 1000)).toBe(true)
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: "k", count: 1 }),
    })
  })

  it("denies when increment misses and the row already exists (at limit)", async () => {
    mockUpdate.mockResolvedValue({ count: 0 })
    mockCreate.mockRejectedValue(new Error("unique constraint"))
    expect(await dbRateLimit("k", 5, 1000)).toBe(false)
  })

  it("always clears this key's own expired row before deciding", async () => {
    mockUpdate.mockResolvedValue({ count: 1 })
    await dbRateLimit("k", 5, 1000, 10_000)
    expect(mockDelete).toHaveBeenCalledWith({
      where: { key: "k", resetAt: { lte: new Date(10_000) } },
    })
  })

  it("prunes a row whose window ends exactly at now — lte, not lt", async () => {
    // resetAt === now means the window has expired; a `lt` prune would leave it,
    // then updateMany (gt now) misses and create collides → the key wedges.
    mockUpdate.mockResolvedValue({ count: 0 })
    mockCreate.mockResolvedValue({})
    await dbRateLimit("k", 5, 1000, 10_000)
    expect(mockDelete).toHaveBeenCalledWith({
      where: { key: "k", resetAt: { lte: new Date(10_000) } },
    })
  })

  it("does NOT run a full-table prune on every call — only the per-key delete", async () => {
    // Math.random pinned below the 2% prune threshold so the global prune is skipped.
    const rnd = jest.spyOn(Math, "random").mockReturnValue(0.99)
    try {
      mockUpdate.mockResolvedValue({ count: 1 })
      await dbRateLimit("k", 5, 1000, 10_000)
      // Only the scoped per-key delete fires; no unscoped { resetAt } full-table DELETE.
      expect(mockDelete).toHaveBeenCalledTimes(1)
      expect(mockDelete).not.toHaveBeenCalledWith({
        where: { resetAt: { lte: new Date(10_000) } },
      })
    } finally {
      rnd.mockRestore()
    }
  })

  it("opportunistically prunes all expired rows when the dice roll hits", async () => {
    const rnd = jest.spyOn(Math, "random").mockReturnValue(0)
    try {
      mockUpdate.mockResolvedValue({ count: 1 })
      await dbRateLimit("k", 5, 1000, 10_000)
      expect(mockDelete).toHaveBeenCalledWith({
        where: { resetAt: { lte: new Date(10_000) } },
      })
    } finally {
      rnd.mockRestore()
    }
  })

  it("increments only an active, under-limit row for the key", async () => {
    mockUpdate.mockResolvedValue({ count: 1 })
    await dbRateLimit("k", 5, 1000, 10_000)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { key: "k", resetAt: { gt: new Date(10_000) }, count: { lt: 5 } },
      data: { count: { increment: 1 } },
    })
  })
})
