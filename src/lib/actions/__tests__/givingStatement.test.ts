jest.mock("@/lib/featureFlags")
import { listGivingStatements, sendGivingStatements, listStatementSendLog } from "@/lib/actions/givingStatement"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { sendGivingStatementEmail } from "@/lib/email"
import { loadStatements, loadStatementFamilies } from "@/lib/givingStatementData"
import { buildStatements } from "@/lib/givingStatement"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendGivingStatementEmail: jest.fn() }))
jest.mock("@/lib/pdf/GivingStatementPdf", () => ({ renderGivingStatementPdf: jest.fn(async () => Buffer.from("%PDF-")) }))
jest.mock("@/lib/givingStatementData", () => ({ loadStatements: jest.fn(), loadStatementFamilies: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettingsForReceipt: jest.fn(async () => ({
    church: { name: "Example Church", address: "1 St", abn: "1", email: "c@x.com", website: "" },
  })),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findMany: jest.fn() },
    family: { findMany: jest.fn() },
    appSetting: { create: jest.fn(), deleteMany: jest.fn() },
  },
}))

const mockAuth = auth as jest.Mock
const mockLoad = loadStatements as jest.Mock
const mockFamilies = loadStatementFamilies as jest.Mock
const mockSend = sendGivingStatementEmail as jest.Mock
const mockLogAudit = logAudit as jest.Mock
const findLog = prisma.auditLog.findMany as jest.Mock
const mockClaimCreate = prisma.appSetting.create as jest.Mock
const mockClaimDelete = prisma.appSetting.deleteMany as jest.Mock

const statements = () =>
  buildStatements([
    { date: new Date("2025-08-01T00:00:00Z"), description: "x", amount: 10, fundName: null, familyId: 1 },
    { date: new Date("2025-08-01T00:00:00Z"), description: "y", amount: 20, fundName: "Alms", familyId: 2 },
  ])

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mockLoad.mockResolvedValue(statements())
  mockFamilies.mockResolvedValue(
    new Map([
      [1, { id: 1, name: "Smith", emails: ["s@x.com"] }],
      [2, { id: 2, name: "Jones", emails: [] }],
    ])
  )
  findLog.mockResolvedValue([])
})

describe("listGivingStatements", () => {
  it("rejects roles without accounting view", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    expect(await listGivingStatements(2025)).toEqual({ error: "Unauthorized" })
  })

  it("rejects a bad year", async () => {
    expect(await listGivingStatements(1900)).toEqual({ error: "Invalid financial year." })
  })

  it("lists families sorted, flags missing email, never returns addresses", async () => {
    findLog.mockResolvedValue([{ action: "GIVING_STATEMENT_SENT", resourceId: 1, createdAt: new Date("2026-07-01") }])
    const res = await listGivingStatements(2025)
    expect(res).toEqual([
      expect.objectContaining({ familyName: "Jones", canEmail: false, lastStatus: null }),
      expect.objectContaining({ familyName: "Smith", canEmail: true, lastStatus: "SENT", total: 10 }),
    ])
    expect(JSON.stringify(res)).not.toContain("s@x.com")
  })
})

describe("sendGivingStatements", () => {
  it.each(["VIEWER", "AUDITOR"])("rejects %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } })
    expect(await sendGivingStatements(2025, [1])).toEqual({ error: "Unauthorized" })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("rejects empty and oversize batches", async () => {
    expect(await sendGivingStatements(2025, [])).toEqual({ error: "Select at least one family." })
    const many = Array.from({ length: 201 }, (_, i) => i + 1)
    expect(await sendGivingStatements(2025, many)).toEqual({ error: "Max 200 per batch" })
  })

  it("sends, logs per recipient without the address, and reports a no-email family", async () => {
    const res = await sendGivingStatements(2025, [1, 2])
    expect(res).toEqual({ sent: 1, failed: 1, skipped: 0, errors: [expect.objectContaining({ familyId: 2 })] })
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls[0][0]).toBe("s@x.com")
    expect(mockLogAudit).toHaveBeenCalledWith(1, "GIVING_STATEMENT_SENT", "Family", 1, { fyStartYear: 2025, totalCents: 1000 })
    expect(JSON.stringify(mockLogAudit.mock.calls)).not.toContain("s@x.com")
  })

  it("records a failed delivery and continues", async () => {
    mockSend.mockRejectedValueOnce(new Error("smtp to s@x.com"))
    const res = await sendGivingStatements(2025, [1])
    expect(res).toEqual({ sent: 0, failed: 1, skipped: 0, errors: [{ familyId: 1, error: "Email delivery failed" }] })
    expect(mockLogAudit).toHaveBeenCalledWith(1, "GIVING_STATEMENT_FAILED", "Family", 1, { fyStartYear: 2025 })
  })

  it("skips a family whose claim already exists (concurrent or already sent)", async () => {
    mockClaimCreate.mockRejectedValueOnce({ code: "P2002" })
    expect(await sendGivingStatements(2025, [1])).toEqual({ sent: 0, failed: 0, skipped: 1, errors: [] })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("resend clears the old claim first and releases the claim on failure", async () => {
    const res = await sendGivingStatements(2025, [1], false)
    expect(res).toEqual(expect.objectContaining({ sent: 1 }))
    expect(mockClaimDelete).toHaveBeenCalledWith({ where: { key: "giving-statement-claim:2025:1" } })
    mockClaimDelete.mockClear()
    mockSend.mockRejectedValueOnce(new Error("x"))
    await sendGivingStatements(2025, [1])
    expect(mockClaimDelete).toHaveBeenCalledWith({ where: { key: "giving-statement-claim:2025:1" } })
  })

  it("returns a clear error when giving cannot be loaded safely", async () => {
    mockLoad.mockRejectedValueOnce(new Error("Too many gifts"))
    expect(await sendGivingStatements(2025, [1])).toEqual({ error: "Too many gifts" })
  })
})

describe("listStatementSendLog", () => {
  it("maps audit rows to log rows", async () => {
    findLog.mockResolvedValue([
      { id: 5, action: "GIVING_STATEMENT_FAILED", resourceId: 1, createdAt: new Date("2026-07-01"), user: { name: "Pat" } },
    ])
    ;(prisma.family.findMany as jest.Mock).mockResolvedValue([{ id: 1, name: "Smith" }])
    expect(await listStatementSendLog(2025)).toEqual([
      { id: 5, familyId: 1, familyName: "Smith", status: "FAILED", at: new Date("2026-07-01"), sentBy: "Pat" },
    ])
  })
})
