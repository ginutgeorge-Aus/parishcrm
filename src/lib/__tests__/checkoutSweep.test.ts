/** @jest-environment node */
import { sweepExpiredCheckouts } from "@/lib/checkoutSweep"

jest.mock("@/lib/prisma", () => ({ prisma: { checkoutSession: { updateMany: jest.fn() } } }))
const { prisma } = require("@/lib/prisma")

// bearerOk moved to @/lib/cronAuth (single shared impl) — see cronAuth.test.ts.

it("expires OPEN sessions past expiresAt and scrubs the payload", async () => {
  prisma.checkoutSession.updateMany.mockResolvedValue({ count: 3 })
  const res = await sweepExpiredCheckouts()
  expect(res.expired).toBe(3)
  const arg = prisma.checkoutSession.updateMany.mock.calls[0][0]
  expect(arg.where.status).toBe("OPEN")
  expect(arg.where.expiresAt.lt).toBeInstanceOf(Date)
  expect(arg.data.status).toBe("EXPIRED")
  expect(arg.data.payload).toBe("") // PII scrubbed
})
