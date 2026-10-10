/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findUnique: jest.fn(), create: jest.fn(), upsert: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
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
import { loadComplianceRows, toComplianceRow, COMPLIANCE_CAP } from "@/lib/clearanceCompliance"
import { runClearanceDigest, runClearanceDigestLocked } from "@/lib/clearanceDigest"

const findUnique = prisma.appSetting.findUnique as jest.Mock
const create = prisma.appSetting.create as jest.Mock
const upsert = prisma.appSetting.upsert as jest.Mock
const DKEY = "clearanceDigestDelivered"
/** findUnique mock: lease row (`last`) plus the delivered row (`delivered`, or none). */
const setRows = (last: string, delivered?: { month: string; emails: string[] }) =>
  findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key === KEY ? { key: KEY, value: last } : delivered ? { key: DKEY, value: JSON.stringify(delivered) } : null)
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
  setRows("2026-10")
  upsert.mockResolvedValue({})
  updateMany.mockResolvedValue({ count: 1 })
  settingDeleteMany.mockResolvedValue({ count: 1 })
  create.mockResolvedValue({})
  users.mockResolvedValue([{ email: "admin@example.com" }, { email: "pastor@example.com" }])
  send.mockResolvedValue(undefined)
  ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: flaggedRows() })
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

  it("covers people past the page cap (digest is not truncated)", async () => {
    const many = Array.from({ length: COMPLIANCE_CAP + 3 }, (_, i) => toComplianceRow({
      id: i + 1, firstName: "P" + i, lastName: "Testperson", ministryRoles: ["STAFF"], family: { name: "F" }, clearances: [],
    }, new Date()))
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: many })
    const r = await runClearanceDigestLocked(FIRST)
    expect(r).toMatchObject({ flagged: COMPLIANCE_CAP + 3, sent: 2, failed: 0 })
  })

  it("sends nothing when every bucket is empty, but still records the month so it is not retried", async () => {
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: cleanRows() })
    const r = await runClearanceDigestLocked(FIRST)
    expect(send).not.toHaveBeenCalled()
    expect(r).toEqual({ flagged: 0, sent: 0, failed: 0 })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: MONTH } })
  })

  it("is 'done' (no work) when this month already ran, unless forced", async () => {
    setRows(MONTH)
    expect(await runClearanceDigestLocked(FIRST)).toBe("done")
    expect(send).not.toHaveBeenCalled()
    expect(await runClearanceDigestLocked(FIRST, { force: true })).toMatchObject({ sent: 2 })
  })

  it("is 'locked' while another run holds a fresh lease", async () => {
    setRows(lease(new Date(FIRST.getTime() - 60_000)))
    expect(await runClearanceDigestLocked(FIRST)).toBe("locked")
    expect(send).not.toHaveBeenCalled()
  })

  it("reclaims a stale lease (crashed run)", async () => {
    setRows(lease(new Date(FIRST.getTime() - 3 * 60 * 60_000)))
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

  it("after a partial failure records who got it, keeps the month open, and a retry emails only the failed one", async () => {
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("bad address"))
    const r = await runClearanceDigestLocked(FIRST)
    expect(r).toEqual({ flagged: 1, sent: 1, failed: 1 })
    expect(upsert).toHaveBeenLastCalledWith({
      where: { key: DKEY },
      create: { key: DKEY, value: JSON.stringify({ month: MONTH, emails: ["admin@example.com"] }) },
      update: { value: JSON.stringify({ month: MONTH, emails: ["admin@example.com"] }) },
    })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: "2026-10" } }) // open

    jest.clearAllMocks()
    send.mockResolvedValue(undefined)
    setRows("2026-10", { month: MONTH, emails: ["admin@example.com"] })
    const retry = await runClearanceDigestLocked(new Date(FIRST.getTime() + 30 * 60_000))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toBe("pastor@example.com")
    expect(retry).toEqual({ flagged: 1, sent: 1, failed: 0 })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: expect.stringContaining("running:") }, data: { value: MONTH } })
  })

  it("marks the month done without sending when everyone already has it (case-insensitive)", async () => {
    setRows("2026-10", { month: MONTH, emails: ["ADMIN@example.com", "pastor@Example.com"] })
    const r = await runClearanceDigestLocked(FIRST)
    expect(send).not.toHaveBeenCalled()
    expect(r).toEqual({ flagged: 1, sent: 0, failed: 0 })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: MONTH } })
  })

  it("force resends to everyone and replaces the delivered list with this run's deliveries", async () => {
    setRows(MONTH, { month: MONTH, emails: ["admin@example.com", "pastor@example.com"] })
    const r = await runClearanceDigestLocked(FIRST, { force: true })
    expect(send).toHaveBeenCalledTimes(2)
    expect(r).toMatchObject({ sent: 2, failed: 0 })
    // No eager reset: the first write already holds a real delivery.
    expect(upsert.mock.calls[0][0].update.value).toBe(JSON.stringify({ month: MONTH, emails: ["admin@example.com"] }))
  })

  it("emails an address once when two accounts differ only by case or spaces", async () => {
    users.mockResolvedValue([{ email: "admin@example.com" }, { email: " Admin@Example.com " }])
    const r = await runClearanceDigestLocked(FIRST)
    expect(send).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ flagged: 1, sent: 1, failed: 0 })
  })

  it("does not report failures for retry when the delivered list could not be saved", async () => {
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("bad address"))
    upsert.mockRejectedValue(new Error("db down"))
    const r = await runClearanceDigestLocked(FIRST)
    expect(r).toEqual({ flagged: 1, sent: 1, failed: 0 })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: MONTH } }) // done, no repeat
  })

  it("ignores a delivered list from an earlier month", async () => {
    setRows("2026-10", { month: "2026-10", emails: ["admin@example.com", "pastor@example.com"] })
    const r = await runClearanceDigestLocked(FIRST)
    expect(send).toHaveBeenCalledTimes(2)
    expect(r).toMatchObject({ sent: 2 })
    expect(upsert.mock.calls.at(-1)![0].update.value).toBe(JSON.stringify({ month: MONTH, emails: ["admin@example.com", "pastor@example.com"] }))
  })

  it("stores only email addresses in the delivered list", async () => {
    await runClearanceDigestLocked(FIRST)
    for (const [arg] of upsert.mock.calls) expect(Object.keys(JSON.parse(arg.create.value)).sort()).toEqual(["emails", "month"])
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
    setRows(MONTH)
    expect(await runClearanceDigest(FIRST)).toEqual({ flagged: 0, sent: 0, failed: 0 })
  })
  it("throws when locked so the scheduler does not record success", async () => {
    setRows(lease(new Date(FIRST.getTime() - 60_000)))
    await expect(runClearanceDigest(FIRST)).rejects.toThrow(/in progress/)
  })
})
