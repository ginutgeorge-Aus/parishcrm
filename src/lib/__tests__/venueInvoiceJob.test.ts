/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueUsageRequest: { upsert: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
    venueUsage: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    auditLog: { findFirst: jest.fn() },
  },
}))
jest.mock("@/lib/venueUsageSettings", () => ({ readVenueUsageSettings: jest.fn() }))
jest.mock("@/lib/venueInvoice", () => ({
  MAX_ROWS_PER_MONTH: 200,
  prepareInvoiceRequest: jest.fn(),
  deliverInvoiceRequest: jest.fn(),
  warnIfMonthCapped: jest.fn(),
}))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }))
jest.mock("@/lib/emailTemplateStore", () => ({ getChurchName: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }))

import { prisma } from "@/lib/prisma"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { deliverInvoiceRequest, prepareInvoiceRequest, warnIfMonthCapped } from "@/lib/venueInvoice"
import { sendEmail } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { logAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { FEATURE_OFF_SKIP } from "@/lib/features"
import { runVenueInvoiceJob, VENUE_JOB_LEASE_MS } from "@/lib/venueInvoiceJob"

const OPEN = new Date("2026-10-31T22:00:00Z") // 1 Nov 09:00 AEDT: invoices October
const OPEN_3RD = new Date("2026-11-03T00:00:00Z") // 3 Nov 11:00 AEDT: still in the window
const CLOSED = new Date("2026-10-31T21:00:00Z") // 1 Nov 08:00 AEDT
const AFTER_WINDOW = new Date("2026-11-07T22:00:00Z") // 8 Nov 09:00 AEDT
const ZERO = { sent: 0, notified: 0, failed: 0, inFlight: 0 }
const complete = ["04", "11", "18", "25"].map((d) => ({ date: new Date(`2026-10-${d}T00:00:00Z`), status: "CONFIRMED", startTime: "17:00", endTime: "20:30" }))
const staff = [{ email: "a@example.com" }, { email: "b@example.com" }]
const updateMany = () => prisma.venueUsageRequest.updateMany as jest.Mock
const findUnique = () => prisma.venueUsageRequest.findUnique as jest.Mock

beforeEach(() => {
  jest.resetAllMocks()
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: true, contactEmail: "venue@example.com", venueName: "Example Hall" })
  ;(prisma.venueUsageRequest.upsert as jest.Mock).mockResolvedValue({})
  updateMany().mockResolvedValue({ count: 1 })
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: null })
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(complete)
  ;(prisma.user.findMany as jest.Mock).mockResolvedValue(staff)
  ;(getChurchName as jest.Mock).mockResolvedValue("Example Church")
  ;(prepareInvoiceRequest as jest.Mock).mockResolvedValue({ rows: complete.map((r) => ({ ...r, startTime: "17:00", endTime: "20:30" })) })
  ;(deliverInvoiceRequest as jest.Mock).mockResolvedValue({ status: "SUCCESS", errorMessage: null, recorded: true, stale: false, snapshot: { rowCount: 4, hours: 14 } })
})

it("does nothing outside the Sydney 1st-7th >= 09:00 window", async () => {
  expect(await runVenueInvoiceJob(CLOSED)).toEqual(ZERO)
  expect(await runVenueInvoiceJob(AFTER_WINDOW)).toEqual(ZERO)
  expect(updateMany()).not.toHaveBeenCalled()
})

it("returns the feature-off skip (period stays open) when disabled or no contact email", async () => {
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: false, contactEmail: "x@example.com" })
  expect(await runVenueInvoiceJob(OPEN)).toEqual(FEATURE_OFF_SKIP)
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: true, contactEmail: "" })
  expect(await runVenueInvoiceJob(OPEN)).toEqual(FEATURE_OFF_SKIP)
})

it("claims the previous month with a stale-lease WHERE", async () => {
  await runVenueInvoiceJob(OPEN)
  const claim = updateMany().mock.calls[0][0]
  expect(claim.where.month).toBe("2026-10")
  expect(claim.where.reminderSentAt).toBeNull()
  expect(claim.where.OR).toEqual([{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: expect.any(Date) } }])
  const staleBefore: Date = claim.where.OR[1].reminderClaimedAt.lt
  expect(claim.data.reminderClaimedAt.getTime() - staleBefore.getTime()).toBe(VENUE_JOB_LEASE_MS)
})

it("a lost claim sends nothing and reports in-flight; an already-notified month is done", async () => {
  updateMany().mockResolvedValueOnce({ count: 0 })
  findUnique().mockResolvedValueOnce({ reminderSentAt: null })
  expect(await runVenueInvoiceJob(OPEN)).toEqual({ ...ZERO, inFlight: 1 })
  updateMany().mockResolvedValueOnce({ count: 0 })
  findUnique().mockResolvedValueOnce({ reminderSentAt: new Date() })
  expect(await runVenueInvoiceJob(OPEN)).toEqual(ZERO)
  expect(sendEmail).not.toHaveBeenCalled()
  expect(deliverInvoiceRequest).not.toHaveBeenCalled()
})

it("two concurrent runs: only the claim winner works", async () => {
  updateMany().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
  findUnique()
    .mockResolvedValueOnce({ id: 3, status: null, approvedAt: new Date() }) // winner's load
    .mockResolvedValueOnce({ reminderSentAt: null }) // loser's check
  const [a, b] = await Promise.all([runVenueInvoiceJob(OPEN), runVenueInvoiceJob(OPEN)])
  expect(deliverInvoiceRequest).toHaveBeenCalledTimes(1)
  expect([a, b].filter((r) => (r as { inFlight: number }).inFlight === 1)).toHaveLength(1)
})

it("approved + complete: sends with autoSent, notifies staff, then sets reminderSentAt", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  const r = await runVenueInvoiceJob(OPEN)
  expect(r).toEqual({ sent: 1, notified: 2, failed: 0, inFlight: 0 })
  expect(deliverInvoiceRequest).toHaveBeenCalledWith(expect.anything(), { month: "2026-10", userId: null, autoSent: true, resend: false })
  expect((sendEmail as jest.Mock).mock.calls[0][1]).toBe("Invoice request for October 2026 sent")
  const calls = updateMany().mock.calls
  const doneIdx = calls.findIndex((c) => c[0].data.reminderSentAt instanceof Date)
  expect(doneIdx).toBeGreaterThan(0)
  expect(calls[doneIdx][0].where.reminderClaimedAt).toBeInstanceOf(Date) // fenced on our claim
  expect((sendEmail as jest.Mock).mock.invocationCallOrder[1]).toBeLessThan(updateMany().mock.invocationCallOrder[doneIdx])
})

it("an audit failure after a successful send does not fail the run", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  ;(logAudit as jest.Mock).mockRejectedValue(new Error("audit down"))
  expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 1, notified: 2, failed: 0, inFlight: 0 })
  expect(updateMany().mock.calls.some((c) => c[0].data.reminderSentAt instanceof Date)).toBe(true)
})

it("not approved: sends the reminder (what is missing / not approved), never the invoice", async () => {
  const r = await runVenueInvoiceJob(OPEN)
  expect(deliverInvoiceRequest).not.toHaveBeenCalled()
  expect(r).toEqual({ sent: 0, notified: 2, failed: 0, inFlight: 0 })
  expect((sendEmail as jest.Mock).mock.calls[0][1]).toBe("Venue invoice request for October 2026 needs attention")
  expect((sendEmail as jest.Mock).mock.calls[0][3]).toContain("not been approved")
})

it("approved but no longer complete: reminder lists the gap, no invoice", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(complete.slice(1))
  await runVenueInvoiceJob(OPEN)
  expect(deliverInvoiceRequest).not.toHaveBeenCalled()
  expect((sendEmail as jest.Mock).mock.calls[0][3]).toContain("Sunday, 4 October")
})

it("already sent manually (SUCCESS, not autoSent): releases the claim and does nothing", async () => {
  findUnique().mockResolvedValue({ id: 3, status: "SUCCESS", approvedAt: new Date(), autoSent: false })
  expect(await runVenueInvoiceJob(OPEN)).toEqual(ZERO)
  expect(sendEmail).not.toHaveBeenCalled()
  expect(updateMany().mock.calls.at(-1)[0].data).toEqual({ reminderClaimedAt: null })
})

it("a failed invoice send releases the claim, reports failed, and never sets reminderSentAt", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  ;(deliverInvoiceRequest as jest.Mock).mockResolvedValue({ status: "FAILED", errorMessage: "smtp" })
  expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 0, notified: 0, failed: 1, inFlight: 0 })
  const datas = updateMany().mock.calls.map((c) => c[0].data)
  expect(datas.some((d) => d.reminderSentAt)).toBe(false)
  expect(datas.at(-1)).toEqual({ reminderClaimedAt: null })
})

it("a manual send in flight (BUSY) releases the claim, reports inFlight, and notifies nobody (#528)", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  ;(deliverInvoiceRequest as jest.Mock).mockResolvedValue({ status: "BUSY", errorMessage: "busy", recorded: false, stale: false, snapshot: { rowCount: 4, hours: 14 } })
  expect(await runVenueInvoiceJob(OPEN)).toEqual({ ...ZERO, inFlight: 1 })
  expect(sendEmail).not.toHaveBeenCalled()
  const datas = updateMany().mock.calls.map((c) => c[0].data)
  expect(datas.some((d) => d.reminderSentAt)).toBe(false)
  expect(datas.at(-1)).toEqual({ reminderClaimedAt: null })
})

it("BUSY on the last window day logs an error to escalate; earlier days only warn (#536)", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  ;(deliverInvoiceRequest as jest.Mock).mockResolvedValue({ status: "BUSY", errorMessage: "busy", recorded: false, stale: false })
  jest.useFakeTimers()
  try {
    jest.setSystemTime(new Date("2026-11-07T01:00:00Z")) // 7 Nov 12:00 AEDT, last window day
    await runVenueInvoiceJob(new Date("2026-11-07T01:00:00Z"))
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("send it by hand"))
    jest.setSystemTime(OPEN)
    await runVenueInvoiceJob(OPEN)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("refused (BUSY"))
  } finally {
    jest.useRealTimers()
  }
})

it("all notices failing keeps the month open; a partial failure does not", async () => {
  ;(sendEmail as jest.Mock).mockRejectedValue(new Error("smtp"))
  expect(await runVenueInvoiceJob(OPEN)).toMatchObject({ notified: 0, failed: 2 })
  expect(updateMany().mock.calls.at(-1)[0].data).toEqual({ reminderClaimedAt: null })
  ;(sendEmail as jest.Mock).mockReset().mockRejectedValueOnce(new Error("smtp")).mockResolvedValueOnce(undefined)
  expect(await runVenueInvoiceJob(OPEN)).toMatchObject({ notified: 1, failed: 0 })
})

it("sent but unrecorded + every notice failed: closes the month (never releases) so the venue is not emailed twice", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  ;(deliverInvoiceRequest as jest.Mock).mockResolvedValue({ status: "SUCCESS", errorMessage: null, recorded: false, stale: false, snapshot: { rowCount: 4, hours: 14 } })
  ;(sendEmail as jest.Mock).mockRejectedValue(new Error("smtp"))
  expect(await runVenueInvoiceJob(OPEN)).toMatchObject({ sent: 1, notified: 0 })
  const calls = updateMany().mock.calls.map((c) => c[0])
  expect(calls.some((c) => "reminderClaimedAt" in c.data && c.data.reminderClaimedAt === null)).toBe(false)
  const done = calls.find((c) => c.data.reminderSentAt instanceof Date)
  expect(done?.where.reminderClaimedAt).toBeInstanceOf(Date)
  expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/not recorded/))
})

const releases = () => updateMany().mock.calls.filter((c) => c[0].data.reminderClaimedAt === null)
const doneWrites = () => updateMany().mock.calls.filter((c) => c[0].data.reminderSentAt instanceof Date)

it("notifyEditors throwing after an unrecorded send still records completion and keeps the claim", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  ;(deliverInvoiceRequest as jest.Mock).mockResolvedValue({ status: "SUCCESS", errorMessage: null, recorded: false, stale: false, snapshot: { rowCount: 4, hours: 14 } })
  ;(prisma.user.findMany as jest.Mock).mockRejectedValue(new Error("db down"))
  expect(await runVenueInvoiceJob(OPEN)).toMatchObject({ sent: 1, notified: 0 })
  expect(doneWrites()).toHaveLength(1)
  expect(releases()).toHaveLength(0)
  expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/notifying staff threw/))
})

it("a reminderSentAt write that fails once is retried and the run succeeds", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  updateMany().mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error("blip")).mockResolvedValue({ count: 1 })
  expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 1, notified: 2, failed: 0, inFlight: 0 })
  expect(doneWrites()).toHaveLength(2)
  expect(releases()).toHaveLength(0)
})

it("a reminderSentAt write that always fails after a send is not success, keeps the claim and logs", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  updateMany().mockResolvedValueOnce({ count: 1 }).mockRejectedValue(new Error("db down"))
  const r = await runVenueInvoiceJob(OPEN)
  expect(r).toMatchObject({ sent: 1, notified: 2 })
  expect((r as { failed: number }).failed).toBeGreaterThan(0)
  expect(doneWrites()).toHaveLength(3)
  expect(releases()).toHaveLength(0)
  expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/completion for 2026-10 is unrecorded/))
})

it("a thrown error releases the claim, logs the original and rethrows", async () => {
  ;(prisma.venueUsage.findMany as jest.Mock).mockRejectedValue(new Error("db"))
  await expect(runVenueInvoiceJob(OPEN)).rejects.toThrow("db")
  expect(updateMany().mock.calls.at(-1)[0].data).toEqual({ reminderClaimedAt: null })
  expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/venueInvoiceJob.*db/))
})

it("a failing release cannot mask the original error", async () => {
  ;(prisma.venueUsage.findMany as jest.Mock).mockRejectedValue(new Error("db"))
  updateMany().mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error("release down"))
  await expect(runVenueInvoiceJob(OPEN)).rejects.toThrow("db")
})

it("a run on the 3rd after a completed run does nothing", async () => {
  updateMany().mockResolvedValueOnce({ count: 0 })
  findUnique().mockResolvedValueOnce({ reminderSentAt: new Date("2026-10-31T22:00:05Z") })
  expect(await runVenueInvoiceJob(OPEN_3RD)).toEqual(ZERO)
  expect(sendEmail).not.toHaveBeenCalled()
  expect(deliverInvoiceRequest).not.toHaveBeenCalled()
  expect(updateMany()).toHaveBeenCalledTimes(1)
})

it("a run on the 3rd with no prior run does the work for October", async () => {
  expect(await runVenueInvoiceJob(OPEN_3RD)).toEqual({ sent: 0, notified: 2, failed: 0, inFlight: 0 })
  expect(updateMany().mock.calls[0][0].where.month).toBe("2026-10")
  expect(updateMany().mock.calls.some((c) => c[0].data.reminderSentAt instanceof Date)).toBe(true)
})

describe("auto-sent request whose staff notices all failed", () => {
  const sentByJob = { id: 3, status: "SUCCESS", approvedAt: new Date(), autoSent: true, staleAt: null }

  it("the retry re-sends only the staff notices (never the venue email) and then sets reminderSentAt", async () => {
    // Run 1: the venue email goes out, every notice fails, the claim is released.
    findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
    ;(sendEmail as jest.Mock).mockRejectedValue(new Error("smtp"))
    expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 1, notified: 0, failed: 2, inFlight: 0 })
    expect(deliverInvoiceRequest).toHaveBeenCalledTimes(1)
    expect(updateMany().mock.calls.some((c) => c[0].data.reminderSentAt)).toBe(false)

    // Run 2 (retry): the row now reads SUCCESS + autoSent; mail works again.
    findUnique().mockResolvedValue(sentByJob)
    ;(sendEmail as jest.Mock).mockReset().mockResolvedValue(undefined)
    updateMany().mockClear()
    expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 0, notified: 2, failed: 0, inFlight: 0 })
    expect(deliverInvoiceRequest).toHaveBeenCalledTimes(1) // still only the first run's send
    expect((sendEmail as jest.Mock).mock.calls[0][1]).toBe("Invoice request for October 2026 sent")
    const done = updateMany().mock.calls.find((c) => c[0].data.reminderSentAt instanceof Date)
    expect(done?.[0].where.reminderClaimedAt).toBeInstanceOf(Date)
    expect(logAudit).toHaveBeenCalledWith(null, "VENUE_INVOICE_NOTICE_SENT", "VenueUsageRequest", 3, expect.objectContaining({ month: "2026-10", notified: 2 }))
  })

  it("a notices-only retry that fails again keeps the month open for the next attempt", async () => {
    findUnique().mockResolvedValue(sentByJob)
    ;(sendEmail as jest.Mock).mockRejectedValue(new Error("smtp"))
    expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 0, notified: 0, failed: 2, inFlight: 0 })
    expect(deliverInvoiceRequest).not.toHaveBeenCalled()
    expect(updateMany().mock.calls.at(-1)[0].data).toEqual({ reminderClaimedAt: null })
  })
})

it("checks the month read against the row cap (truncation is never silent)", async () => {
  await runVenueInvoiceJob(OPEN)
  expect(warnIfMonthCapped).toHaveBeenCalledWith("venueInvoiceJob", "2026-10", complete.length)
})

it("a send that raced a booking change tells staff to check and resend (#509 #512)", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  ;(deliverInvoiceRequest as jest.Mock).mockResolvedValue({ status: "SUCCESS", errorMessage: null, recorded: true, stale: true, snapshot: { rowCount: 4, hours: 14 } })
  expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 1, notified: 2, failed: 0, inFlight: 0 })
  expect((sendEmail as jest.Mock).mock.calls[0][3]).toMatch(/bookings changed while it was being sent.*Send again/)
})

describe("notices-only retry rebuilds the notice from the persisted send (#536 #549)", () => {
  const sentByJob = { id: 3, status: "SUCCESS", approvedAt: null, autoSent: true }
  const mailText = () => (sendEmail as jest.Mock).mock.calls[0][3] as string

  it("reads staleAt and the sent snapshot in the single top-level findUnique (one read, no torn pair)", async () => {
    findUnique().mockResolvedValue({ ...sentByJob, staleAt: null, sentRowCount: 4, sentHours: "14" })
    await runVenueInvoiceJob(OPEN)
    expect(findUnique()).toHaveBeenCalledTimes(1)
    expect(findUnique().mock.calls[0][0].select).toMatchObject({ staleAt: true, sentRowCount: true, sentHours: true })
  })
  it("uses the persisted rows/hours and does not call prepareInvoiceRequest", async () => {
    findUnique().mockResolvedValue({ ...sentByJob, staleAt: null, sentRowCount: 2, sentHours: "7.5" })
    expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 0, notified: 2, failed: 0, inFlight: 0 })
    expect(prepareInvoiceRequest).not.toHaveBeenCalled()
    expect(mailText()).toContain("2 confirmed dates, 7.5 hours")
    expect(mailText()).toMatch(/7\.5 hours/)
    expect(mailText()).not.toMatch(/changed/)
  })
  it("adds the check-and-resend line when the persisted send was stale", async () => {
    findUnique().mockResolvedValue({ ...sentByJob, staleAt: new Date("2026-11-01T00:00:00Z"), sentRowCount: 2, sentHours: "7.5" })
    await runVenueInvoiceJob(OPEN)
    expect(prepareInvoiceRequest).not.toHaveBeenCalled()
    expect(mailText()).toMatch(/bookings changed while it was being sent/)
  })
  it("legacy row (null snapshot) counts the current CONFIRMED rows with a cheap read (no prepare), still honouring staleAt", async () => {
    findUnique().mockResolvedValue({ ...sentByJob, staleAt: new Date("2026-11-01T00:00:00Z"), sentRowCount: null, sentHours: null })
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([
      { date: new Date("2026-10-04T00:00:00Z"), startTime: "17:00", endTime: "20:30", status: "CONFIRMED" },
      { date: new Date("2026-10-11T00:00:00Z"), startTime: "17:00", endTime: "20:30", status: "REQUESTED" },
    ])
    await runVenueInvoiceJob(OPEN)
    expect(prepareInvoiceRequest).not.toHaveBeenCalled()
    expect(mailText()).toMatch(/3\.5 hours/)
    expect(mailText()).toMatch(/bookings changed while it was being sent/)
  })
  it("staleAt null but the send's audit row says stale: the warning is kept (legacy row or a lost staleAt write)", async () => {
    ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({ metadata: { month: "2026-10", stale: true } })
    findUnique().mockResolvedValue({ ...sentByJob, staleAt: null, sentRowCount: 2, sentHours: "7.5" })
    await runVenueInvoiceJob(OPEN)
    expect(mailText()).toMatch(/bookings changed while it was being sent/)
    findUnique().mockResolvedValue({ ...sentByJob, staleAt: null, sentRowCount: null, sentHours: null })
    ;(sendEmail as jest.Mock).mockClear()
    await runVenueInvoiceJob(OPEN)
    expect(mailText()).toMatch(/bookings changed while it was being sent/)
  })
  it("an audit read failure never blocks the retry (treated as not stale)", async () => {
    ;(prisma.auditLog.findFirst as jest.Mock).mockRejectedValue(new Error("db"))
    findUnique().mockResolvedValue({ ...sentByJob, staleAt: null, sentRowCount: 2, sentHours: "7.5" })
    expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 0, notified: 2, failed: 0, inFlight: 0 })
    expect(mailText()).not.toMatch(/changed/)
  })
  it("leaves the line out when the send was not stale (legacy row)", async () => {
    findUnique().mockResolvedValue({ ...sentByJob, staleAt: null, sentRowCount: null, sentHours: null })
    await runVenueInvoiceJob(OPEN)
    expect(mailText()).not.toMatch(/changed/)
  })

  describe("crash between the SUCCESS outcome write and the stale marker (#550)", () => {
    const sentAt = new Date("2026-10-31T22:00:00.000Z")
    const old = new Date("2026-10-20T00:00:00Z")
    const recorded = { ...sentByJob, staleAt: null, sentAt, sentRowCount: 4, sentHours: "14" }
    const rows = (updatedAt: Date[]) => complete.map((r, i) => ({ ...r, updatedAt: updatedAt[i] ?? old }))

    it("no audit row for this send (process died before staleAt and audit): a row edited during the send keeps the warning", async () => {
      ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null)
      findUnique().mockResolvedValue(recorded)
      ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(rows([new Date(sentAt.getTime() - 1000)]))
      expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 0, notified: 2, failed: 0, inFlight: 0 })
      expect(findUnique().mock.calls[0][0].select).toMatchObject({ sentAt: true })
      expect(mailText()).toContain("4 confirmed dates, 14 hours")
      expect(mailText()).toMatch(/bookings changed while it was being sent/)
    })
    it("re-derived: a CONFIRMED row deleted since the send (count no longer matches the snapshot) keeps the warning", async () => {
      ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null)
      findUnique().mockResolvedValue(recorded)
      ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(rows([]).slice(1))
      await runVenueInvoiceJob(OPEN)
      expect(mailText()).toMatch(/bookings changed while it was being sent/)
    })
    it("re-derived: rows untouched since well before the send and matching the snapshot leave the line out", async () => {
      ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null)
      findUnique().mockResolvedValue(recorded)
      ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(rows([]))
      await runVenueInvoiceJob(OPEN)
      expect(mailText()).not.toMatch(/changed/)
    })
    it("an audit row from an earlier send does not stand in for this one: the check is re-derived", async () => {
      ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({ metadata: { month: "2026-10", sentAt: "2026-10-01T00:00:00.000Z" } })
      findUnique().mockResolvedValue(recorded)
      ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(rows([new Date(sentAt.getTime() + 1000)]))
      await runVenueInvoiceJob(OPEN)
      expect(mailText()).toMatch(/bookings changed while it was being sent/)
    })
    it("this send's audit row without a stale flag means the check ran clean: no re-derive, no line", async () => {
      ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({ metadata: { month: "2026-10", sentAt: sentAt.toISOString() } })
      findUnique().mockResolvedValue(recorded)
      ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(rows([new Date(sentAt.getTime() + 1000)]))
      await runVenueInvoiceJob(OPEN)
      expect(prisma.venueUsage.findMany).not.toHaveBeenCalled()
      expect(mailText()).not.toMatch(/changed/)
    })
    it("an audit row flagged recheckFailed (post-send re-check threw) is re-derived even though it has this send's sentAt", async () => {
      ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({ metadata: { month: "2026-10", recheckFailed: true } })
      findUnique().mockResolvedValue(recorded)
      ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(rows([new Date(sentAt.getTime() + 1000)]))
      await runVenueInvoiceJob(OPEN)
      expect(mailText()).toMatch(/bookings changed while it was being sent/)
    })
    it("a failed re-derive read errs toward the warning and never blocks the retry", async () => {
      ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null)
      findUnique().mockResolvedValue(recorded)
      ;(prisma.venueUsage.findMany as jest.Mock).mockRejectedValue(new Error("db"))
      expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 0, notified: 2, failed: 0, inFlight: 0 })
      expect(mailText()).toMatch(/bookings changed while it was being sent/)
    })
  })
})

it("a month sent but unrecorded whose completion write also failed reports no failure so the scheduler memo stops later ticks, and logs loudly", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  ;(deliverInvoiceRequest as jest.Mock).mockResolvedValue({ status: "SUCCESS", errorMessage: null, recorded: false, stale: false, snapshot: { rowCount: 4, hours: 14 } })
  updateMany().mockResolvedValueOnce({ count: 1 }).mockRejectedValue(new Error("db down"))
  expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 1, notified: 2, failed: 0, inFlight: 0 })
  expect(releases()).toHaveLength(0)
  expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/Do NOT restart.*withdrawVenueApproval/))
})

it("a month sent but unrecorded whose completion write fails withdraws the approval and reports a failure (no restart resend)", async () => {
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  ;(deliverInvoiceRequest as jest.Mock).mockResolvedValue({ status: "SUCCESS", errorMessage: null, recorded: false, stale: false, snapshot: { rowCount: 4, hours: 14 } })
  updateMany().mockImplementation(async (a: { data: Record<string, unknown> }) => {
    if (a.data.reminderSentAt) throw new Error("db blip")
    return { count: 1 }
  })
  expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 1, notified: 2, failed: 1, inFlight: 0 })
  expect(updateMany()).toHaveBeenCalledWith({ where: { month: "2026-10", approvedAt: { not: null } }, data: { approvedAt: null, approvedById: null } })
  expect(releases()).toHaveLength(0)
})
