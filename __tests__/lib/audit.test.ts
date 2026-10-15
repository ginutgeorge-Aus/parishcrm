/** @jest-environment node */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { create: jest.fn() },
  },
}))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn() } }))

import { prisma } from "@/lib/prisma"
import { logAudit, logAuditTx } from "@/lib/audit"
import { logger } from "@/lib/logger"

const mockCreate = prisma.auditLog.create as jest.Mock
const mockLoggerError = logger.error as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe("logAudit", () => {
  it("creates an audit log entry with all fields", async () => {
    mockCreate.mockResolvedValue({})
    await logAudit(1, "VIEW_PASTORAL_NOTES", "Person", 42, { extra: "data" }, "1.2.3.4")
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        userId: 1,
        action: "VIEW_PASTORAL_NOTES",
        resourceType: "Person",
        resourceId: 42,
        metadata: { extra: "data" },
        ip: "1.2.3.4",
      },
    })
  })

  it("omits optional fields when not provided", async () => {
    mockCreate.mockResolvedValue({})
    await logAudit(2, "USER_LOGIN", "User")
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        userId: 2,
        action: "USER_LOGIN",
        resourceType: "User",
        resourceId: undefined,
        metadata: undefined,
        ip: undefined,
      },
    })
  })

  it("swallows errors silently — never throws", async () => {
    mockCreate.mockRejectedValue(new Error("DB connection lost"))
    await expect(logAudit(1, "EXPORT_CSV", "Event")).resolves.toBeUndefined()
  })

  it("logs the failure (ids/action only, no PII) so a silent audit outage is observable", async () => {
    mockCreate.mockRejectedValue(new Error("DB connection lost"))
    await logAudit(1, "EXPORT_CSV", "Event", 7, { pii: "should-not-be-logged" })
    expect(mockLoggerError).toHaveBeenCalledWith("audit log write failed", {
      action: "EXPORT_CSV",
      resourceType: "Event",
      resourceId: 7,
      error: "DB connection lost",
    })
  })
})

describe("logAuditTx", () => {
  it("writes through the transaction client, not the global one", async () => {
    const txCreate = jest.fn().mockResolvedValue({})
    const tx = { auditLog: { create: txCreate } } as unknown as Parameters<typeof logAuditTx>[0]
    await logAuditTx(tx, 4, "CLEARANCE_ADDED", "Person", 9, { type: "WWCC" })
    expect(txCreate).toHaveBeenCalledWith({
      data: {
        userId: 4,
        action: "CLEARANCE_ADDED",
        resourceType: "Person",
        resourceId: 9,
        metadata: { type: "WWCC" },
        ip: undefined,
      },
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rethrows a failed write so the enclosing transaction rolls back", async () => {
    const boom = new Error("audit table unavailable")
    const tx = { auditLog: { create: jest.fn().mockRejectedValue(boom) } } as unknown as Parameters<typeof logAuditTx>[0]
    await expect(logAuditTx(tx, 4, "CLEARANCE_ADDED", "Person", 9)).rejects.toBe(boom)
    expect(mockLoggerError).not.toHaveBeenCalled()
  })
})
