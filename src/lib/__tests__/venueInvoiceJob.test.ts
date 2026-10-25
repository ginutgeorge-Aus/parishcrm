/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueUsageRequest: { upsert: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
    venueUsage: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/venueUsageSettings", () => ({ readVenueUsageSettings: jest.fn() }))
jest.mock("@/lib/venueInvoice", () => ({
  MAX_ROWS_PER_MONTH: 200,
  prepareInvoiceRequest: jest.fn(),
  deliverInvoiceRequest: jest.fn(),
}))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }))
jest.mock("@/lib/emailTemplateStore", () => ({ getChurchName: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))

import { prisma } from "@/lib/prisma"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { deliverInvoiceRequest, prepareInvoiceRequest } from "@/lib/venueInvoice"
import { sendEmail } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { logAudit } from "@/lib/audit"
import { FEATURE_OFF_SKIP } from "@/lib/features"
import { runVenueInvoiceJob, VENUE_JOB_LEASE_MS } from "@/lib/venueInvoiceJob"

const OPEN = new Date("2026-10-31T22:00:00Z") // 1 Nov 09:00 AEDT: invoices October
const OPEN_3RD = new Date("2026-11-03T00:00:00Z") // 3 Nov 11:00 AEDT: still in the window
const CLOSED = new Date("2026-10-31T21:00:00Z") // 1 Nov 08:00 AEDT
const AFTER_WINDOW = new Date("2026-11-07T22:00:00Z") // 8 Nov 09:00 AEDT
const ZERO = { sent: 0, notified: 0, failed: 0, inFlight: 0 }
const complete = ["04", "11", "18", "25"].map((d) => ({ date: new Date(`2026-10-${d}T00:00:00Z`), status: "CONFIRMED" }))
const staff = [{ email: "a@example.com" }, { email: "b@example.com" }]
const updateMany = () => prisma.venueUsageRequest.updateMany as jest.Mock
const findUnique = () => prisma.venueUsageRequest.findUnique as jest.Mock

beforeEach(() => {
  jest.resetAllMocks()
  jest.spyOn(console, "error").mockImplementation(() => undefined)
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: true, contactEmail: "venue@example.com", venueName: "Example Hall" })
  ;(prisma.venueUsageRequest.upsert as jest.Mock).mockResolvedValue({})
  updateMany().mockResolvedValue({ count: 1 })
  findUnique().mockResolvedValue({ id: 3, status: null, approvedAt: null })
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(complete)
  ;(prisma.user.findMany as jest.Mock).mockResolvedValue(staff)
  ;(getChurchName as jest.Mock).mockResolvedValue("Example Church")
  ;(prepareInvoiceRequest as jest.Mock).mockResolvedValue({ rows: complete.map((r) => ({ ...r, startTime: "17:00", endTime: "20:30" })) })
  ;(deliverInvoiceRequest as jest.Mock).mockResolvedValue({ status: "SUCCESS", errorMessage: null })
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

it("already sent (SUCCESS): releases the claim and does nothing", async () => {
  findUnique().mockResolvedValue({ id: 3, status: "SUCCESS", approvedAt: new Date() })
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

it("all notices failing keeps the month open; a partial failure does not", async () => {
  ;(sendEmail as jest.Mock).mockRejectedValue(new Error("smtp"))
  expect(await runVenueInvoiceJob(OPEN)).toMatchObject({ notified: 0, failed: 2 })
  expect(updateMany().mock.calls.at(-1)[0].data).toEqual({ reminderClaimedAt: null })
  ;(sendEmail as jest.Mock).mockReset().mockRejectedValueOnce(new Error("smtp")).mockResolvedValueOnce(undefined)
  expect(await runVenueInvoiceJob(OPEN)).toMatchObject({ notified: 1, failed: 0 })
})

it("a thrown error releases the claim, logs the original and rethrows", async () => {
  ;(prisma.venueUsage.findMany as jest.Mock).mockRejectedValue(new Error("db"))
  await expect(runVenueInvoiceJob(OPEN)).rejects.toThrow("db")
  expect(updateMany().mock.calls.at(-1)[0].data).toEqual({ reminderClaimedAt: null })
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("venueInvoiceJob"), expect.objectContaining({ message: "db" }))
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
