/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
    user: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn(), isAmbiguousDeliveryError: jest.fn((e: { ambiguous?: boolean }) => e?.ambiguous === true) }))
jest.mock("@/lib/emailTemplateStore", () => ({ getChurchName: jest.fn().mockResolvedValue("Test Church") }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }))
jest.mock("@/lib/clearanceCompliance", () => ({
  ...jest.requireActual("@/lib/clearanceCompliance"),
  loadComplianceRows: jest.fn(),
}))

import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { logAudit } from "@/lib/audit"
import { loadComplianceRows, toComplianceRow } from "@/lib/clearanceCompliance"
import { runClearanceDigest, runClearanceDigestLocked } from "@/lib/clearanceDigest"

const findUnique = prisma.appSetting.findUnique as jest.Mock
const create = prisma.appSetting.create as jest.Mock
const updateMany = prisma.appSetting.updateMany as jest.Mock
const settingDeleteMany = prisma.appSetting.deleteMany as jest.Mock
const users = prisma.user.findMany as jest.Mock
const send = sendEmail as jest.Mock

const KEY = "clearanceDigestLastMonth"
const FIRST = new Date("2026-10-31T20:00:00Z") // Sun 2026-11-01 07:00 AEDT
const MONTH = "2026-11"
const lease = (at: Date) => `running:${MONTH}:${at.getTime()}`

const flaggedRows = () => [
  toComplianceRow({
    id: 1, firstName: "Alex", lastName: "Testperson", ministryRoles: ["STAFF"], family: { name: "F" },
    clearances: [{ id: "c11", type: "WWCC", number: "enc:WWC0000000E", expiresAt: new Date("2020-01-01T00:00:00Z"), verifiedAt: new Date() }],
  }, new Date("2026-11-01T00:00:00Z")),
]
const cleanRows = () => [
  toComplianceRow({
    id: 2, firstName: "Bo", lastName: "Sample", ministryRoles: ["STAFF"], family: { name: "F" },
    clearances: [
      { id: "c21", type: "WWCC", number: "enc:x", expiresAt: new Date("2030-01-01T00:00:00Z"), verifiedAt: new Date() },
      { id: "c22", type: "SAFE_MINISTRY", number: null, expiresAt: new Date("2030-01-01T00:00:00Z"), verifiedAt: new Date() },
    ],
  }, new Date("2026-11-01T00:00:00Z")),
]

beforeEach(() => {
  jest.clearAllMocks()
  findUnique.mockResolvedValue({ key: KEY, value: "2026-10" })
  updateMany.mockResolvedValue({ count: 1 })
  settingDeleteMany.mockResolvedValue({ count: 1 })
  create.mockResolvedValue({})
  users.mockResolvedValue([{ email: "admin@example.com" }, { email: "pastor@example.com" }])
  send.mockResolvedValue(undefined)
  ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: flaggedRows(), truncated: false })
})

describe("runClearanceDigestLocked", () => {
  it("emails every active ADMIN and PASTOR once, with names and no sensitive values, then records the month", async () => {
    const r = await runClearanceDigestLocked(FIRST)
    expect(users).toHaveBeenCalledWith({ where: { role: { in: ["ADMIN", "PASTOR"] }, archivedAt: null }, select: { email: true } })
    expect(send).toHaveBeenCalledTimes(2)
    const [to, subject, html, text] = send.mock.calls[0]
    expect(to).toBe("admin@example.com")
    expect(subject).toBe("Clearance compliance digest — Test Church")
    expect(text).toContain("Alex Testperson — Working With Children Check")
    expect(html + text).not.toContain("WWC0000000E")
    expect(r).toEqual({ flagged: 1, sent: 2, failed: 0 })
    expect(updateMany).toHaveBeenNthCalledWith(1, { where: { key: KEY, value: "2026-10" }, data: { value: lease(FIRST) } })
    expect(updateMany).toHaveBeenNthCalledWith(2, { where: { key: KEY, value: lease(FIRST) }, data: { value: MONTH } })
    expect(logAudit).toHaveBeenCalledWith(null, "CLEARANCE_DIGEST_SENT", "Person", undefined, expect.objectContaining({ sent: 2, failed: 0, flagged: 1 }))
  })

  it("creates the setting row on the very first run", async () => {
    findUnique.mockResolvedValue(null)
    await runClearanceDigestLocked(FIRST)
    expect(create).toHaveBeenCalledWith({ data: { key: KEY, value: lease(FIRST) } })
  })

  it("sends nothing when every bucket is empty, but still records the month so it is not retried", async () => {
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: cleanRows(), truncated: false })
    const r = await runClearanceDigestLocked(FIRST)
    expect(send).not.toHaveBeenCalled()
    expect(r).toEqual({ flagged: 0, sent: 0, failed: 0 })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: MONTH } })
  })

  it("is 'done' (no work) when this month already ran, unless forced", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: MONTH })
    expect(await runClearanceDigestLocked(FIRST)).toBe("done")
    expect(send).not.toHaveBeenCalled()
    expect(await runClearanceDigestLocked(FIRST, { force: true })).toMatchObject({ sent: 2 })
  })

  it("is 'locked' while another run holds a fresh lease", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: lease(new Date(FIRST.getTime() - 60_000)) })
    expect(await runClearanceDigestLocked(FIRST)).toBe("locked")
    expect(send).not.toHaveBeenCalled()
  })

  it("reclaims a stale lease (crashed run)", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: lease(new Date(FIRST.getTime() - 3 * 60 * 60_000)) })
    expect(await runClearanceDigestLocked(FIRST)).toMatchObject({ sent: 2 })
  })

  it("is 'locked' when it loses the compare-and-set race", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await runClearanceDigestLocked(FIRST)).toBe("locked")
    expect(send).not.toHaveBeenCalled()
  })

  it("releases the lease and reports failures when every send fails, so the scheduler retries", async () => {
    send.mockRejectedValue(new Error("smtp down"))
    const r = await runClearanceDigestLocked(FIRST)
    expect(r).toEqual({ flagged: 1, sent: 0, failed: 2 })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: "2026-10" } })
  })

  it("keeps the month recorded after a partial failure (no resend to those who got it)", async () => {
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("bad address"))
    const r = await runClearanceDigestLocked(FIRST)
    expect(r).toEqual({ flagged: 1, sent: 1, failed: 1 })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: MONTH } })
  })

  it("treats an ambiguous delivery error as sent (never resend on a maybe)", async () => {
    send.mockRejectedValue(Object.assign(new Error("socket closed"), { ambiguous: true }))
    expect(await runClearanceDigestLocked(FIRST)).toEqual({ flagged: 1, sent: 2, failed: 0 })
  })

  it("records the month with no send when there is nobody to email", async () => {
    users.mockResolvedValue([])
    expect(await runClearanceDigestLocked(FIRST)).toEqual({ flagged: 1, sent: 0, failed: 0 })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: MONTH } })
  })

  it("releases the lease and rethrows when the query throws", async () => {
    ;(loadComplianceRows as jest.Mock).mockRejectedValue(new Error("db down"))
    await expect(runClearanceDigestLocked(FIRST)).rejects.toThrow("db down")
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: "2026-10" } })
  })
})

describe("runClearanceDigest (scheduler entry)", () => {
  it("returns zeros when the month is already done", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: MONTH })
    expect(await runClearanceDigest(FIRST)).toEqual({ flagged: 0, sent: 0, failed: 0 })
  })
  it("throws when locked so the scheduler does not record success", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: lease(new Date(FIRST.getTime() - 60_000)) })
    await expect(runClearanceDigest(FIRST)).rejects.toThrow(/in progress/)
  })
})
