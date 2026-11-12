jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn() } }))
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))

import { logger } from "@/lib/logger"
import { AuditWriteError, AUDIT_FAILED_ERROR, auditWriteFailedResult } from "@/lib/auditGuard"

describe("auditWriteFailedResult", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns AUDIT_FAILED_ERROR and logs only name + code (no message/args/stack)", () => {
    const cause = Object.assign(new Error("Invalid `prisma.auditLog.create()` invocation: payee=Jane Doe"), { code: "P2003" })
    const res = auditWriteFailedResult(new AuditWriteError(cause), "someAction")
    expect(res).toEqual({ error: AUDIT_FAILED_ERROR })
    expect(logger.error).toHaveBeenCalledWith("someAction audit write failed", { name: "Error", code: "P2003" })
    const logged = JSON.stringify((logger.error as jest.Mock).mock.calls)
    expect(logged).not.toMatch(/Jane Doe|invocation|stack/)
  })

  it("tolerates a non-Error cause", () => {
    auditWriteFailedResult(new AuditWriteError("boom"), "x")
    expect(logger.error).toHaveBeenCalledWith("x audit write failed", { name: "string", code: undefined })
  })

  it("tolerates an undefined cause", () => {
    auditWriteFailedResult(new AuditWriteError(undefined), "y")
    expect(logger.error).toHaveBeenCalledWith("y audit write failed", { name: "undefined", code: undefined })
  })
})
