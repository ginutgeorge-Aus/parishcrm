/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    venueUsage: { findMany: jest.fn(), updateMany: jest.fn() },
    venueUsageRequest: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("@/lib/email", () => ({ sendVenueUsageRequestEmail: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn(async () => ({ name: "Example Church" })) }))
jest.mock("@/lib/venueUsageSettings", () => ({ readVenueUsageSettings: jest.fn() }))
jest.mock("@/lib/emailTemplateStore", () => ({ getEmailTemplate: jest.fn(async () => undefined) }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit, logAuditTx } from "@/lib/audit"
import { sendVenueUsageRequestEmail } from "@/lib/email"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import {
  getBookingRequestPreview, sendBookingRequest, approveVenueMonth, withdrawVenueApproval,
} from "@/lib/actions/venueBookings"

const asRole = (role: string | null) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "7", role } } : null)

const settings = {
  enabled: true, venueName: "Example Hall", contactName: "Pat Example",
  contactEmail: "venue@example.com", ccEmail: "", replyToEmail: "", bookingCcEmails: "sec@example.com",
}

const candidateRows = [
  { id: 1, date: new Date("2026-11-01T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "REQUESTED" },
  { id: 2, date: new Date("2026-11-08T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "REQUESTED" },
]
const bookedRows = [{ date: new Date("2026-11-15T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "CONFIRMED" }]

/** Queue the three findMany results used by the preview: candidates, asked, booked. */
function mockPreviewRows(): void {
  ;(prisma.venueUsage.findMany as jest.Mock)
    .mockResolvedValueOnce([
      { id: 1, date: new Date("2026-11-01T00:00:00Z"), startTime: "17:00", endTime: "20:00", purpose: null },
      { id: 2, date: new Date("2026-11-08T00:00:00Z"), startTime: "17:00", endTime: "20:00", purpose: "Service" },
    ])
    .mockResolvedValueOnce([{ id: 3, date: new Date("2026-10-25T00:00:00Z"), bookingRequestedAt: new Date("2026-10-20T00:00:00Z") }])
    .mockResolvedValueOnce([{ date: new Date("2026-11-15T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "CONFIRMED" }])
}

beforeEach(() => {
  jest.resetAllMocks()
  jest.useFakeTimers().setSystemTime(new Date("2026-10-25T02:00:00Z"))
  const { assertNotDemo } = jest.requireMock("@/lib/demoMode")
  ;(assertNotDemo as jest.Mock).mockReturnValue(null)
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(prisma))
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue(settings)
  ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ name: "Sam Admin", email: "sam@example.com" })
  jest.requireMock("@/lib/churchSettings").getChurchSettings.mockResolvedValue({ name: "Example Church" })
  jest.requireMock("@/lib/emailTemplateStore").getEmailTemplate.mockResolvedValue(undefined)
})

afterEach(() => {
  jest.useRealTimers()
})

describe("getBookingRequestPreview", () => {
  it("gates role and feature", async () => {
    asRole("VIEWER")
    expect(await getBookingRequestPreview()).toEqual({ error: "Unauthorized" })
    asRole("PASTOR")
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ ...settings, enabled: false })
    expect(await getBookingRequestPreview()).toEqual({ error: "Venue usage is not enabled" })
  })

  it("ticks every candidate by default and lists asked + already-booked dates", async () => {
    asRole("PASTOR")
    mockPreviewRows()
    const p = await getBookingRequestPreview()
    if ("error" in p) throw new Error(p.error)
    expect(p.selectedIds).toEqual([1, 2])
    expect(p.asked).toEqual([{ id: 3, date: "2026-10-25", askedOn: "2026-10-20" }])
    expect(p.booked).toEqual(["Sunday, 15 November: 5:00 PM – 8:00 PM (3 hours)"])
    expect(p.text).toContain("Sunday, 1 November")
    expect(p.text).toContain("Sunday, 15 November")
    expect(p.to).toBe("venue@example.com")
  })

  it("builds the email for only the ticked ids and blocks when none are ticked", async () => {
    asRole("PASTOR")
    mockPreviewRows()
    const p = await getBookingRequestPreview([2])
    if ("error" in p) throw new Error(p.error)
    expect(p.selectedIds).toEqual([2])
    expect(p.text).not.toContain("Sunday, 1 November")
    mockPreviewRows()
    const none = await getBookingRequestPreview([])
    if ("error" in none) throw new Error(none.error)
    expect(none.blockedReason).toBe("Tick at least one date")
  })
})

describe("sendBookingRequest", () => {
  it("gates role, demo, ids and venue contact", async () => {
    asRole("VIEWER")
    expect(await sendBookingRequest([1])).toEqual({ error: "Unauthorized" })
    asRole("PASTOR")
    expect(await sendBookingRequest([])).toEqual({ error: "Tick at least one date" })
    expect(await sendBookingRequest([0])).toEqual({ error: "Invalid booking" })
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ ...settings, contactEmail: "" })
    expect(await sendBookingRequest([1])).toEqual({ error: "Set the venue contact email in Settings first" })
    const { assertNotDemo } = jest.requireMock("@/lib/demoMode")
    ;(assertNotDemo as jest.Mock).mockReturnValue({ error: "demo" })
    expect(await sendBookingRequest([1])).toEqual({ error: "demo" })
  })

  it("claims the rows, sends once with booking CCs, audits", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValueOnce(candidateRows).mockResolvedValueOnce(bookedRows)
    ;(prisma.venueUsage.updateMany as jest.Mock).mockResolvedValue({ count: 2 })
    expect(await sendBookingRequest([1, 2])).toEqual({ success: "Booking request sent for 2 dates" })
    const claim = (prisma.venueUsage.updateMany as jest.Mock).mock.calls[0][0]
    expect(claim.where).toMatchObject({ id: { in: [1, 2] }, status: "REQUESTED", bookingRequestedAt: null })
    expect(claim.data.bookingRequestedAt).toBeInstanceOf(Date)
    expect(sendVenueUsageRequestEmail).toHaveBeenCalledTimes(1)
    expect((sendVenueUsageRequestEmail as jest.Mock).mock.calls[0][0].cc).toBe("sec@example.com, sam@example.com")
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_BOOKING_REQUEST_SENT", "VenueUsage", undefined, { count: 2, ids: [1, 2] })
  })

  it("stamps venueNotifiedAt after a successful send, only where it is still null (never on claim)", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValueOnce(candidateRows).mockResolvedValueOnce(bookedRows)
    ;(prisma.venueUsage.updateMany as jest.Mock).mockResolvedValue({ count: 2 })
    await sendBookingRequest([1, 2])
    const calls = (prisma.venueUsage.updateMany as jest.Mock).mock.calls.map((c) => c[0])
    expect(calls[0].data).not.toHaveProperty("venueNotifiedAt")
    const stamp = calls.find((c) => "venueNotifiedAt" in c.data)
    expect(stamp.where).toEqual({ id: { in: [1, 2] }, venueNotifiedAt: null })
    expect(stamp.data.venueNotifiedAt).toBeInstanceOf(Date)
    expect((sendVenueUsageRequestEmail as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan((prisma.venueUsage.updateMany as jest.Mock).mock.invocationCallOrder[calls.indexOf(stamp)])
  })

  it("still reports success when the venueNotifiedAt stamp fails after a send", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValueOnce(candidateRows).mockResolvedValueOnce(bookedRows)
    ;(prisma.venueUsage.updateMany as jest.Mock).mockResolvedValueOnce({ count: 2 }).mockRejectedValueOnce(new Error("db"))
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    expect(await sendBookingRequest([1, 2])).toEqual({ success: "Booking request sent for 2 dates" })
    spy.mockRestore()
  })

  it("retries the venueNotifiedAt stamp once before logging", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValueOnce(candidateRows).mockResolvedValueOnce(bookedRows)
    ;(prisma.venueUsage.updateMany as jest.Mock)
      .mockResolvedValueOnce({ count: 2 }).mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce({ count: 2 })
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    expect(await sendBookingRequest([1, 2])).toEqual({ success: "Booking request sent for 2 dates" })
    expect(prisma.venueUsage.updateMany).toHaveBeenCalledTimes(3)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it("still reports success when the audit write fails after a send", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValueOnce(candidateRows).mockResolvedValueOnce(bookedRows)
    ;(prisma.venueUsage.updateMany as jest.Mock).mockResolvedValue({ count: 2 })
    ;(logAudit as jest.Mock).mockRejectedValue(new Error("db"))
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    expect(await sendBookingRequest([1, 2])).toEqual({ success: "Booking request sent for 2 dates" })
    spy.mockRestore()
  })

  it("sends nothing when another request already claimed the rows (double click)", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValueOnce(candidateRows)
    ;(prisma.venueUsage.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await sendBookingRequest([1, 2])).toEqual({ error: "Those dates were already requested. Refresh the page." })
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
  })

  it("releases the claim and reports an error when the send fails", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValueOnce(candidateRows).mockResolvedValueOnce(bookedRows)
    ;(prisma.venueUsage.updateMany as jest.Mock).mockResolvedValue({ count: 2 })
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp"))
    expect(await sendBookingRequest([1, 2])).toEqual({ error: "Could not send the email. Check email settings and try again." })
    const release = (prisma.venueUsage.updateMany as jest.Mock).mock.calls[1][0]
    expect(release.data).toEqual({ bookingRequestedAt: null })
    const datas = (prisma.venueUsage.updateMany as jest.Mock).mock.calls.map((c) => c[0].data)
    expect(datas.some((d) => "venueNotifiedAt" in d)).toBe(false)
    expect(release.where.bookingRequestedAt).toBeInstanceOf(Date)
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_BOOKING_REQUEST_FAILED", "VenueUsage", undefined, { count: 2, ids: [1, 2] })
  })
})

describe("approveVenueMonth / withdrawVenueApproval", () => {
  const completeRows = ["04", "11", "18", "25"].map((d) => ({ date: new Date(`2026-10-${d}T00:00:00Z`), status: "CONFIRMED" }))

  it("only the current Sydney month can be approved", async () => {
    asRole("PASTOR")
    expect(await approveVenueMonth("2026-09")).toEqual({ error: "Only the current month can be approved" })
    expect(await approveVenueMonth("nope")).toEqual({ error: "Invalid month" })
  })

  it("refuses an incomplete month, a missing contact email and an already-sent month", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(completeRows.slice(1))
    expect(await approveVenueMonth("2026-10")).toEqual({ error: "The month is not complete yet" })
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(completeRows)
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ status: "SUCCESS" })
    expect(await approveVenueMonth("2026-10")).toEqual({ error: "The invoice request for this month was already sent" })
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ ...settings, contactEmail: "" })
    expect(await approveVenueMonth("2026-10")).toEqual({ error: "Set the venue contact email in Settings first" })
    expect(prisma.venueUsageRequest.upsert).not.toHaveBeenCalled()
  })

  it("records approver and time and audits in the same transaction", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(completeRows)
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await approveVenueMonth("2026-10")).toEqual({ success: "Approved: the invoice request will be sent on 1 November, 9:00 AM" })
    const call = (prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[0][0]
    expect(call.update).toMatchObject({ approvedById: 7 })
    expect(call.update.approvedAt).toBeInstanceOf(Date)
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 7, "VENUE_MONTH_APPROVED", "VenueUsageRequest", undefined, { month: "2026-10" })
  })

  it("withdraw clears an unsent approval and audits; AUDITOR is refused", async () => {
    asRole("AUDITOR")
    expect(await withdrawVenueApproval("2026-10")).toEqual({ error: "Unauthorized" })
    asRole("PASTOR")
    ;(prisma.venueUsageRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    expect(await withdrawVenueApproval("2026-10")).toEqual({ success: "Approval withdrawn" })
    expect((prisma.venueUsageRequest.updateMany as jest.Mock).mock.calls[0][0].data).toEqual({ approvedAt: null, approvedById: null })
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 7, "VENUE_APPROVAL_WITHDRAWN", "VenueUsageRequest", undefined, { month: "2026-10" })
    ;(prisma.venueUsageRequest.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await withdrawVenueApproval("2026-10")).toEqual({ error: "There is no approval to withdraw" })
  })
})
