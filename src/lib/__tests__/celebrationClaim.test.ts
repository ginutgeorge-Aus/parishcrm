import { claimCelebrationSend, BIRTHDAY_ACTION } from "@/lib/celebrationClaim"
import { prisma } from "@/lib/prisma"

jest.mock("@/lib/prisma", () => ({
  prisma: {
    celebrationSend: { create: jest.fn(), updateMany: jest.fn() },
  },
}))

const create = prisma.celebrationSend.create as jest.Mock
const updateMany = prisma.celebrationSend.updateMany as jest.Mock

function p2002() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
}

beforeEach(() => {
  jest.clearAllMocks()
})

test("a fresh create wins the claim", async () => {
  create.mockResolvedValueOnce({ id: 1 })
  expect(await claimCelebrationSend(1, BIRTHDAY_ACTION, "2026-06-15")).toBe(true)
  expect(updateMany).not.toHaveBeenCalled()
})

test("( follow-up) a collision reclaims a FAILED slot OR a stale-lease PENDING slot, never a fresh PENDING/SENT", async () => {
  create.mockRejectedValueOnce(p2002())
  updateMany.mockResolvedValueOnce({ count: 1 })

  const before = Date.now()
  const won = await claimCelebrationSend(1, BIRTHDAY_ACTION, "2026-06-15")
  const after = Date.now()

  expect(won).toBe(true)
  expect(updateMany).toHaveBeenCalledTimes(1)
  const where = updateMany.mock.calls[0][0].where
  // FAILED is unconditionally retryable; PENDING only once its lease is stale.
  expect(where.OR).toEqual([
    { status: "FAILED" },
    { status: "PENDING", updatedAt: { lt: expect.any(Date) } },
  ])
  // The staleness cutoff is ~10 min in the past — a fresh PENDING (updatedAt
  // near now) can't match it, so an actively-sending invocation is never stolen.
  const staleBefore: Date = where.OR[1].updatedAt.lt
  expect(staleBefore.getTime()).toBeGreaterThanOrEqual(before - 10 * 60 * 1000 - 5)
  expect(staleBefore.getTime()).toBeLessThanOrEqual(after - 10 * 60 * 1000 + 5)
})

test("a collision that matches no retryable slot loses the claim", async () => {
  create.mockRejectedValueOnce(p2002())
  updateMany.mockResolvedValueOnce({ count: 0 })
  expect(await claimCelebrationSend(1, BIRTHDAY_ACTION, "2026-06-15")).toBe(false)
})

test("a non-P2002 error propagates", async () => {
  create.mockRejectedValueOnce(new Error("db down"))
  await expect(claimCelebrationSend(1, BIRTHDAY_ACTION, "2026-06-15")).rejects.toThrow("db down")
  expect(updateMany).not.toHaveBeenCalled()
})
