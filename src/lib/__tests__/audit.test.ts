jest.mock("@/lib/prisma", () => ({ prisma: { auditLog: { create: jest.fn() } } }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn() } }))
import { logAudit } from "@/lib/audit"
import { prisma } from "@/lib/prisma"

const create = prisma.auditLog.create as jest.Mock

describe("logAudit", () => {
  beforeEach(() => create.mockReset())

  it("resolves true when the row is written", async () => {
    create.mockResolvedValueOnce({})
    expect(await logAudit(1, "X", "Family", 2)).toBe(true)
  })

  it("resolves false instead of throwing when the write fails", async () => {
    create.mockRejectedValueOnce(new Error("db down"))
    expect(await logAudit(1, "X", "Family", 2)).toBe(false)
  })
})
