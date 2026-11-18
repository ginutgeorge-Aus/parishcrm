/** @jest-environment node */
import { sweepExpiredCheckouts, PAYLOAD_GRACE_MS } from "@/lib/checkoutSweep"

jest.mock("@/lib/prisma", () => ({ prisma: { checkoutSession: { updateMany: jest.fn() } } }))
const { prisma } = require("@/lib/prisma")

// bearerOk moved to @/lib/cronAuth (single shared impl) — see cronAuth.test.ts.

beforeEach(() => {
  jest.clearAllMocks()
  prisma.checkoutSession.updateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 3 }) // scrub runs first, then expire
})

it("expires OPEN sessions past expiresAt but keeps the payload so a late Stripe confirmation can still be claimed", async () => {
  const res = await sweepExpiredCheckouts()
  expect(res.expired).toBe(3)
  const arg = prisma.checkoutSession.updateMany.mock.calls[1][0]
  expect(arg.where.status).toBe("OPEN")
  expect(arg.where.expiresAt.lt).toBeInstanceOf(Date)
  expect(arg.data).toEqual({ status: "EXPIRED" }) // payload kept
})

it("scrubs the payload of rows expired more than 72h ago", async () => {
  const before = Date.now()
  const res = await sweepExpiredCheckouts()
  expect(res.scrubbed).toBe(2)
  expect(PAYLOAD_GRACE_MS).toBe(72 * 60 * 60 * 1000)
  const arg = prisma.checkoutSession.updateMany.mock.calls[0][0]
  expect(arg.where.status).toBe("EXPIRED")
  expect(arg.where.payload).toEqual({ not: "" })
  const cutoff = arg.where.expiresAt.lt.getTime()
  expect(cutoff).toBeLessThanOrEqual(Date.now() - PAYLOAD_GRACE_MS)
  expect(cutoff).toBeGreaterThanOrEqual(before - PAYLOAD_GRACE_MS)
  expect(arg.data).toEqual({ payload: "" }) // PII scrubbed
})

it("scrubs before expiring, so rows newly marked EXPIRED this run keep their payload until the next run", async () => {
  await sweepExpiredCheckouts()
  const [first, second] = prisma.checkoutSession.updateMany.mock.calls.map((c: unknown[]) => (c[0] as { data: unknown }).data)
  expect(first).toEqual({ payload: "" })
  expect(second).toEqual({ status: "EXPIRED" })
})
