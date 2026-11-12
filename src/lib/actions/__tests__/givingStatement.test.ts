jest.mock("@/lib/featureFlags")
import { listGivingStatements, sendGivingStatements, listStatementSendLog } from "@/lib/actions/givingStatement"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { sendGivingStatementEmail } from "@/lib/email"
import { loadStatements, loadStatementSummaries, loadStatementFamilies } from "@/lib/givingStatementData"
import { buildStatements } from "@/lib/givingStatement"
import { featureGuard } from "@/lib/featureFlags"
import { isResendAmbiguous } from "@/lib/resendTransport"

jest.mock("@/lib/resendTransport", () => ({ isResendAmbiguous: jest.fn(() => false) }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendGivingStatementEmail: jest.fn() }))
jest.mock("@/lib/pdf/GivingStatementPdf", () => ({ renderGivingStatementPdf: jest.fn(async () => Buffer.from("%PDF-")) }))
jest.mock("@/lib/givingStatementData", () => ({ loadStatements: jest.fn(), loadStatementSummaries: jest.fn(), loadStatementFamilies: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettingsForReceipt: jest.fn(async () => ({
    church: { name: "Example Church", address: "1 St", abn: "1", email: "c@x.com", website: "" },
  })),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findMany: jest.fn(), groupBy: jest.fn() },
    family: { findMany: jest.fn() },
    appSetting: { findMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  },
}))

const mockAuth = auth as jest.Mock
const mockLoad = loadStatements as jest.Mock
const mockSummaries = loadStatementSummaries as jest.Mock
const groupLog = prisma.auditLog.groupBy as jest.Mock
const findClaims = prisma.appSetting.findMany as jest.Mock
const mockFamilies = loadStatementFamilies as jest.Mock
const mockSend = sendGivingStatementEmail as jest.Mock
const mockLogAudit = logAudit as jest.Mock
const findLog = prisma.auditLog.findMany as jest.Mock
const mockClaimCreate = prisma.appSetting.create as jest.Mock
const mockClaimDelete = prisma.appSetting.deleteMany as jest.Mock
const mockClaimFind = prisma.appSetting.findUnique as jest.Mock
const mockClaimSwap = prisma.appSetting.updateMany as jest.Mock
const mockClaimUpdate = prisma.appSetting.update as jest.Mock
const mockGuard = featureGuard as jest.Mock

const statements = () =>
  buildStatements([
    { date: new Date("2025-08-01T00:00:00Z"), amount: 10, fundName: null, familyId: 1 },
    { date: new Date("2025-08-01T00:00:00Z"), amount: 20, fundName: "Alms", familyId: 2 },
  ])

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mockLoad.mockResolvedValue(statements())
  mockSummaries.mockResolvedValue(
    new Map([
      [1, { giftCount: 1, totalCents: 1000 }],
      [2, { giftCount: 1, totalCents: 2000 }],
    ])
  )
  mockFamilies.mockResolvedValue(
    new Map([
      [1, { id: 1, name: "Smith", archived: false, canEmail: true, emails: ["s@x.com"] }],
      [2, { id: 2, name: "Jones", archived: false, canEmail: false, emails: [] }],
    ])
  )
  findLog.mockResolvedValue([])
  groupLog.mockResolvedValue([])
  findClaims.mockResolvedValue([])
  mockClaimFind.mockReset()
  mockClaimDelete.mockReset()
  mockClaimSwap.mockReset()
  mockClaimUpdate.mockReset()
  mockClaimCreate.mockReset()
  mockSend.mockReset()
  mockLogAudit.mockReset()
  mockGuard.mockResolvedValue(null)
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
    groupLog.mockResolvedValue([
      { action: "GIVING_STATEMENT_SENT", resourceId: 1, _max: { createdAt: new Date("2026-07-01") } },
      { action: "GIVING_STATEMENT_FAILED", resourceId: 1, _max: { createdAt: new Date("2026-06-01") } },
    ])
    const res = await listGivingStatements(2025)
    expect(res).toEqual([
      expect.objectContaining({ familyName: "Jones", canEmail: false, lastStatus: null, claim: null, giftCount: 1, total: 20 }),
      expect.objectContaining({ familyName: "Smith", canEmail: true, lastStatus: "SENT", total: 10 }),
    ])
    expect(JSON.stringify(res)).not.toContain("s@x.com")
  })

  it("uses DB-level aggregates: no gift rows loaded and the send log grouped, not scanned", async () => {
    await listGivingStatements(2025)
    expect(mockLoad).not.toHaveBeenCalled()
    expect(mockFamilies).toHaveBeenCalledWith([1, 2], false)
    expect(groupLog.mock.calls[0][0]).toMatchObject({ by: ["resourceId", "action"] })
    expect(findLog).not.toHaveBeenCalled()
  })

  it("keeps the newest of SENT/FAILED, so a later failure wins", async () => {
    groupLog.mockResolvedValue([
      { action: "GIVING_STATEMENT_SENT", resourceId: 1, _max: { createdAt: new Date("2026-06-01") } },
      { action: "GIVING_STATEMENT_FAILED", resourceId: 1, _max: { createdAt: new Date("2026-07-01") } },
      { action: "GIVING_STATEMENT_FAILED", resourceId: null, _max: { createdAt: new Date("2026-07-01") } },
      { action: "GIVING_STATEMENT_SENT", resourceId: 2, _max: { createdAt: null } },
    ])
    const res = (await listGivingStatements(2025)) as { familyName: string; lastStatus: string | null }[]
    expect(res.find((r) => r.familyName === "Smith")?.lastStatus).toBe("FAILED")
    expect(res.find((r) => r.familyName === "Jones")?.lastStatus).toBeNull()
  })

  it("reports claim state and archived flag, ignoring malformed claim rows", async () => {
    findClaims.mockResolvedValue([
      { key: "giving-statement-claim:2025:1", value: "UNKNOWN:5" },
      { key: "giving-statement-claim:2025:2", value: "PENDING:5" },
      { key: "giving-statement-claim:2025:abc", value: "SENT:5" },
      { key: "giving-statement-claim:2025:3", value: "WEIRD:5" },
    ])
    mockFamilies.mockResolvedValue(new Map([[1, { id: 1, name: "Smith", archived: true, canEmail: false, emails: [] }]]))
    expect(await listGivingStatements(2025)).toEqual([expect.objectContaining({ familyId: 1, archived: true, claim: "UNKNOWN" })])
  })

  it("surfaces a load failure as an error", async () => {
    mockSummaries.mockRejectedValueOnce(new Error("db down"))
    expect(await listGivingStatements(2025)).toEqual({ error: "db down" })
    mockSummaries.mockRejectedValueOnce("x")
    expect(await listGivingStatements(2025)).toEqual({ error: "Could not load giving." })
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
    expect(res).toEqual({ sent: 1, failed: 1, skipped: 0, inProgress: 0, errors: [expect.objectContaining({ familyId: 2 })] })
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls[0][0]).toBe("s@x.com")
    expect(mockLogAudit).toHaveBeenCalledWith(1, "GIVING_STATEMENT_SENT", "Family", 1, { fyStartYear: 2025, totalCents: 1000 })
    expect(JSON.stringify(mockLogAudit.mock.calls)).not.toContain("s@x.com")
  })

  it("records a failed delivery and continues", async () => {
    mockSend.mockRejectedValueOnce(new Error("smtp to s@x.com"))
    const res = await sendGivingStatements(2025, [1])
    expect(res).toEqual({ sent: 0, failed: 1, skipped: 0, inProgress: 0, errors: [{ familyId: 1, error: "Email delivery failed" }] })
    expect(mockLogAudit).toHaveBeenCalledWith(1, "GIVING_STATEMENT_FAILED", "Family", 1, { fyStartYear: 2025 })
  })

  it("skips an already SENT claim as 'skipped' (already sent)", async () => {
    mockClaimCreate.mockRejectedValueOnce({ code: "P2002" })
    mockClaimFind.mockResolvedValue({ key: "k", value: "SENT:1" })
    expect(await sendGivingStatements(2025, [1])).toEqual({ sent: 0, failed: 0, skipped: 1, inProgress: 0, errors: [] })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it.each(["PENDING:1", "UNKNOWN:1"])("skips a %s claim as in progress / unknown, not 'already sent'", async (value) => {
    mockClaimCreate.mockRejectedValueOnce({ code: "P2002" })
    mockClaimFind.mockResolvedValue({ key: "k", value })
    expect(await sendGivingStatements(2025, [1])).toEqual({ sent: 0, failed: 0, skipped: 0, inProgress: 1, errors: [] })
  })

  it("reports a missing family, an archived family and a family with no giving", async () => {
    mockFamilies.mockResolvedValue(new Map([[2, { id: 2, name: "Old", archived: true, canEmail: false, emails: ["o@x.com"] }]]))
    mockLoad.mockResolvedValue(new Map([...statements()].filter(([id]) => id === 2)))
    const res = (await sendGivingStatements(2025, [1, 2])) as { errors: { familyId: number; error: string }[] }
    expect(res.errors).toEqual([
      { familyId: 1, error: "Family not found." },
      { familyId: 2, error: "Family is archived; statements are not emailed." },
    ])
    mockFamilies.mockResolvedValue(new Map([[1, { id: 1, name: "S", archived: false, canEmail: true, emails: ["s@x.com"] }]]))
    mockLoad.mockResolvedValue(new Map())
    const res2 = (await sendGivingStatements(2025, [1])) as { errors: { error: string }[] }
    expect(res2.errors[0].error).toMatch(/No giving recorded/)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("a post-send DB failure still counts as sent and the batch continues", async () => {
    mockFamilies.mockResolvedValue(
      new Map([
        [1, { id: 1, name: "Smith", archived: false, canEmail: true, emails: ["s@x.com"] }],
        [2, { id: 2, name: "Jones", archived: false, canEmail: true, emails: ["j@x.com"] }],
      ])
    )
    mockClaimUpdate.mockRejectedValueOnce(new Error("db blip"))
    mockLogAudit.mockRejectedValueOnce(new Error("db blip"))
    const res = await sendGivingStatements(2025, [1, 2])
    expect(res).toEqual({ sent: 2, failed: 0, skipped: 0, inProgress: 0, errors: [] })
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it("releases the claim when building or rendering fails before the send", async () => {
    const { renderGivingStatementPdf } = jest.requireMock("@/lib/pdf/GivingStatementPdf")
    renderGivingStatementPdf.mockRejectedValueOnce(new Error("pdf"))
    const res = await sendGivingStatements(2025, [1])
    expect(res).toEqual(expect.objectContaining({ failed: 1, sent: 0 }))
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockClaimDelete).toHaveBeenCalledWith({ where: { key: "giving-statement-claim:2025:1" } })
  })

  it("survives a DB failure while recording a failed delivery", async () => {
    mockSend.mockRejectedValueOnce(new Error("smtp"))
    mockClaimDelete.mockRejectedValueOnce(new Error("db blip"))
    mockLogAudit.mockRejectedValueOnce(new Error("db blip"))
    expect(await sendGivingStatements(2025, [1])).toEqual(expect.objectContaining({ failed: 1 }))
  })

  it("marks the claim SENT after delivery and releases it on a definite failure", async () => {
    await sendGivingStatements(2025, [1])
    expect(mockClaimUpdate).toHaveBeenCalledWith({
      where: { key: "giving-statement-claim:2025:1" },
      data: { value: expect.stringMatching(/^SENT:\d+$/) },
    })
    mockSend.mockRejectedValueOnce(new Error("x"))
    await sendGivingStatements(2025, [1])
    expect(mockClaimDelete).toHaveBeenCalledWith({ where: { key: "giving-statement-claim:2025:1" } })
  })

  it("keeps the claim as UNKNOWN when delivery is ambiguous", async () => {
    ;(isResendAmbiguous as jest.Mock).mockReturnValueOnce(true)
    mockSend.mockRejectedValueOnce(new Error("timeout"))
    const res = await sendGivingStatements(2025, [1])
    expect(res).toEqual({ sent: 0, failed: 1, skipped: 0, inProgress: 0, errors: [{ familyId: 1, error: "Delivery status unknown; check before resending" }] })
    expect(mockClaimDelete).not.toHaveBeenCalled()
    expect(mockClaimUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { value: expect.stringMatching(/^UNKNOWN:/) } }))
    expect(mockLogAudit).toHaveBeenCalledWith(1, "GIVING_STATEMENT_FAILED", "Family", 1, { fyStartYear: 2025, outcome: "unknown" })
  })

  describe("forced resend", () => {
    beforeEach(() => mockClaimCreate.mockRejectedValueOnce({ code: "P2002" }))

    it("takes over a SENT claim with an atomic compare-and-swap, never delete-then-create", async () => {
      mockClaimFind.mockResolvedValue({ key: "k", value: "SENT:1" })
      mockClaimSwap.mockResolvedValue({ count: 1 })
      const res = await sendGivingStatements(2025, [1], false)
      expect(res).toEqual(expect.objectContaining({ sent: 1 }))
      expect(mockClaimSwap).toHaveBeenCalledWith({
        where: { key: "giving-statement-claim:2025:1", value: "SENT:1" },
        data: { value: expect.stringMatching(/^PENDING:/) },
      })
      expect(mockClaimDelete).not.toHaveBeenCalled()
    })

    it("restores the previous SENT claim (never deletes it) when a forced resend fails definitively", async () => {
      mockClaimFind.mockResolvedValue({ key: "k", value: "SENT:1" })
      mockClaimSwap.mockResolvedValue({ count: 1 })
      mockSend.mockRejectedValueOnce(new Error("smtp"))
      const res = await sendGivingStatements(2025, [1], false)
      expect(res).toEqual(expect.objectContaining({ failed: 1 }))
      expect(mockClaimDelete).not.toHaveBeenCalled()
      expect(mockClaimSwap).toHaveBeenLastCalledWith({
        where: { key: "giving-statement-claim:2025:1", value: expect.stringMatching(/^PENDING:/) },
        data: { value: "SENT:1" },
      })
    })

    it("does not steal a live PENDING claim", async () => {
      mockClaimFind.mockResolvedValue({ key: "k", value: `PENDING:${Date.now()}` })
      expect(await sendGivingStatements(2025, [1], false)).toEqual(expect.objectContaining({ inProgress: 1, skipped: 0, sent: 0 }))
      expect(mockClaimSwap).not.toHaveBeenCalled()
      expect(mockSend).not.toHaveBeenCalled()
    })

    it("takes over a stale PENDING claim (crashed run)", async () => {
      mockClaimFind.mockResolvedValue({ key: "k", value: `PENDING:${Date.now() - 16 * 60_000}` })
      mockClaimSwap.mockResolvedValue({ count: 1 })
      expect(await sendGivingStatements(2025, [1], false)).toEqual(expect.objectContaining({ sent: 1 }))
    })

    it("skips when another run wins the swap", async () => {
      mockClaimFind.mockResolvedValue({ key: "k", value: "SENT:1" })
      mockClaimSwap.mockResolvedValue({ count: 0 })
      expect(await sendGivingStatements(2025, [1], false)).toEqual(expect.objectContaining({ inProgress: 1, sent: 0 }))
    })

    it("skips when the claim vanished between create and read", async () => {
      mockClaimFind.mockResolvedValue(null)
      expect(await sendGivingStatements(2025, [1], false)).toEqual(expect.objectContaining({ inProgress: 1 }))
    })
  })

  it("rethrows unexpected claim errors", async () => {
    mockClaimCreate.mockRejectedValueOnce(new Error("db down"))
    await expect(sendGivingStatements(2025, [1])).rejects.toThrow("db down")
  })

  it("returns a clear error when giving cannot be loaded safely", async () => {
    mockLoad.mockRejectedValueOnce(new Error("Too many gifts"))
    expect(await sendGivingStatements(2025, [1])).toEqual({ error: "Too many gifts" })
  })
})

describe("feature guard", () => {
  const off = { error: "This feature is turned off." }
  it.each([
    ["listGivingStatements", () => listGivingStatements(2025)],
    ["sendGivingStatements", () => sendGivingStatements(2025, [1])],
    ["listStatementSendLog", () => listStatementSendLog(2025)],
  ])("%s returns the feature-off error and does no work", async (_n, call) => {
    mockGuard.mockResolvedValueOnce(off)
    expect(await call()).toEqual(off)
    expect(mockLoad).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
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
