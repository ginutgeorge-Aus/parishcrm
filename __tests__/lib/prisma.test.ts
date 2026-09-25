/** @jest-environment node */

jest.mock("@/lib/generated/prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: { findMany: jest.fn() },
    $transaction: jest.fn(),
  })),
}))
jest.mock("@prisma/adapter-pg", () => ({ PrismaPg: jest.fn() }))

describe("prisma singleton — lazy construction (v1.1.4 deploy fix)", () => {
  const origUrl = process.env.DATABASE_URL

  beforeEach(() => {
    // reset the cross-module global singleton between isolated module loads
    ;(globalThis as Record<string, unknown>).prisma = undefined
  })

  afterEach(() => {
    if (origUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = origUrl
    ;(globalThis as Record<string, unknown>).prisma = undefined
  })

  it("imports without DATABASE_URL — next build page-data collection must not throw", () => {
    delete process.env.DATABASE_URL
    jest.isolateModules(() => {
      expect(() => require("@/lib/prisma")).not.toThrow()
    })
  })

  it("throws loudly on first use when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL
    jest.isolateModules(() => {
      const { prisma } = require("@/lib/prisma")
      expect(() => prisma.user).toThrow("DATABASE_URL is required")
    })
  })

  it("constructs the client on first use when DATABASE_URL is set", () => {
    process.env.DATABASE_URL = "postgresql://x:y@localhost:5432/test"
    jest.isolateModules(() => {
      const { prisma } = require("@/lib/prisma")
      expect(prisma.user).toBeDefined()
    })
  })
})
