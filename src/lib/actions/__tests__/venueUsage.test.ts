/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    venueUsage: { create: jest.fn(), createMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    venueUsageRequest: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    emailTemplate: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    appSetting: { upsert: jest.fn() },
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn(), logAuditManyTx: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("@/lib/email", () => ({ sendVenueUsageRequestEmail: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn(async () => ({ name: "Example Church" })) }))
jest.mock("@/lib/venueUsageSettings", () => ({ readVenueUsageSettings: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit, logAuditTx, logAuditManyTx } from "@/lib/audit"
import { encrypt } from "@/lib/crypto"
import { sendVenueUsageRequestEmail } from "@/lib/email"
import { assertNotDemo } from "@/lib/demoMode"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import {
  createVenueUsage, updateVenueUsage, deleteVenueUsage, sendVenueUsageRequest,
  getVenueRequestPreview, updateVenueUsageSettings, addAllSundays, setVenueUsageStatus,
} from "@/lib/actions/venueUsage"

const asRole = (role: string | null) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "7", role } } : null)

const settings = {
  enabled: true, venueName: "Example Hall", contactName: "Pat Example",
  contactEmail: "venue@example.com", ccEmail: "", replyToEmail: "", bookingCcEmails: "",
}

const validInput = {
  date: "2026-09-06", startTime: "17:00", endTime: "20:30", status: "CONFIRMED" as const,
  purpose: "Sunday service", notes: "",
}

const confirmedRows = [
  { date: new Date("2026-09-06T00:00:00Z"), startTime: "17:00", endTime: "20:30", status: "CONFIRMED" },
]

beforeEach(() => {
  jest.resetAllMocks()
  ;(assertNotDemo as jest.Mock).mockReturnValue(null)
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(prisma))
  ;(prisma.venueUsageRequest.findMany as jest.Mock).mockResolvedValue([])
  ;(encrypt as jest.Mock).mockImplementation((v: string) => `enc:${v}`)
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue(settings)
  ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ name: "Sam Admin", email: "sam@example.com" })
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(confirmedRows)
  ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue(null)
  ;(prisma.venueUsage.create as jest.Mock).mockResolvedValue({ id: 5 })
  ;(prisma.venueUsage.findUnique as jest.Mock).mockResolvedValue({ id: 5, date: new Date("2026-09-06T00:00:00Z") })
  const getCS = jest.requireMock("@/lib/churchSettings").getChurchSettings as jest.Mock
  getCS.mockResolvedValue({ name: "Example Church" })
})

describe("usage row CRUD", () => {
  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER", null])("create rejects role %s", async (role) => {
    asRole(role)
    expect(await createVenueUsage(validInput)).toEqual({ error: "Unauthorized" })
    expect(prisma.venueUsage.create).not.toHaveBeenCalled()
  })

  it("create stores a UTC-midnight date, status and creator, and audits", async () => {
    asRole("OFFICE_ADMIN")
    const r = await createVenueUsage(validInput)
    expect(r).toEqual({ success: "Booking added" })
    const data = (prisma.venueUsage.create as jest.Mock).mock.calls[0][0].data
    expect(data.date.toISOString()).toBe("2026-09-06T00:00:00.000Z")
    expect(data).toMatchObject({ startTime: "17:00", endTime: "20:30", status: "CONFIRMED", purpose: "Sunday service", notes: null, createdById: 7 })
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 7, "VENUE_USAGE_CREATED", "VenueUsage", 5, expect.any(Object))
  })

  it("create refuses when the feature is off", async () => {
    asRole("ADMIN")
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ ...settings, enabled: false })
    expect(await createVenueUsage(validInput)).toHaveProperty("error")
    expect(prisma.venueUsage.create).not.toHaveBeenCalled()
  })

  it.each([
    [{ startTime: "20:00", endTime: "17:00" }],
    [{ startTime: "17:00", endTime: "17:00" }],
    [{ startTime: "25:00" }],
    [{ date: "2026-02-30" }],
    [{ status: "BOGUS" }],
    [{ notes: "x".repeat(501) }],
  ])("create rejects invalid input %j", async (patch) => {
    asRole("ADMIN")
    const r = await createVenueUsage({ ...validInput, ...patch } as never)
    expect(r).toHaveProperty("error")
    expect(prisma.venueUsage.create).not.toHaveBeenCalled()
  })

  it("update gates role, checks existence, updates and audits", async () => {
    asRole("VIEWER")
    expect(await updateVenueUsage(5, validInput)).toEqual({ error: "Unauthorized" })

    asRole("PASTOR")
    ;(prisma.venueUsage.findUnique as jest.Mock).mockResolvedValueOnce(null)
    expect(await updateVenueUsage(5, validInput)).toEqual({ error: "Booking not found" })
    expect(prisma.venueUsage.update).not.toHaveBeenCalled()

    expect(await updateVenueUsage(5, { ...validInput, status: "CANCELLED" })).toEqual({ success: "Booking updated" })
    expect((prisma.venueUsage.update as jest.Mock).mock.calls[0][0].data.status).toBe("CANCELLED")
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 7, "VENUE_USAGE_UPDATED", "VenueUsage", 5, expect.any(Object))
  })

  it("update rejects an out-of-range id", async () => {
    asRole("ADMIN")
    expect(await updateVenueUsage(0, validInput)).toEqual({ error: "Invalid booking" })
  })

  it("delete gates role, checks existence, deletes and audits", async () => {
    asRole("AUDITOR")
    expect(await deleteVenueUsage(5)).toEqual({ error: "Unauthorized" })
    expect(prisma.venueUsage.delete).not.toHaveBeenCalled()

    asRole("ADMIN")
    ;(prisma.venueUsage.findUnique as jest.Mock).mockResolvedValueOnce(null)
    expect(await deleteVenueUsage(5)).toEqual({ error: "Booking not found" })

    expect(await deleteVenueUsage(5)).toEqual({ success: "Booking deleted" })
    expect(prisma.venueUsage.delete).toHaveBeenCalledWith({ where: { id: 5 } })
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 7, "VENUE_USAGE_DELETED", "VenueUsage", 5, { date: "2026-09-06" })
  })
})

describe("sendVenueUsageRequest", () => {
  it.each(["VIEWER", "AUDITOR", null])("rejects role %s", async (role) => {
    asRole(role)
    expect(await sendVenueUsageRequest("2026-09")).toEqual({ error: "Unauthorized" })
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
  })

  it("rejects a bad month", async () => {
    asRole("ADMIN")
    expect(await sendVenueUsageRequest("2026-13")).toEqual({ error: "Invalid month" })
  })

  it("refuses when disabled, no contact email, or no confirmed rows", async () => {
    asRole("ADMIN")
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValueOnce({ ...settings, enabled: false })
    expect(await sendVenueUsageRequest("2026-09")).toHaveProperty("error")
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValueOnce({ ...settings, contactEmail: "" })
    expect(await sendVenueUsageRequest("2026-09")).toHaveProperty("error")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValueOnce([])
    expect(await sendVenueUsageRequest("2026-09")).toEqual({ error: "No confirmed bookings in this month" })
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
    expect(prisma.venueUsageRequest.upsert).not.toHaveBeenCalled()
  })

  it("queries the month (all statuses for completeness) and sends only CONFIRMED rows", async () => {
    asRole("ADMIN")
    await sendVenueUsageRequest("2026-09")
    const where = (prisma.venueUsage.findMany as jest.Mock).mock.calls[0][0].where
    expect(where.status).toBeUndefined()
    expect(where.date.gte.toISOString()).toBe("2026-09-01T00:00:00.000Z")
    expect(where.date.lte.toISOString()).toBe("2026-09-30T00:00:00.000Z")
  })

  it("success: sends with CC + Reply-To (acting user fallback) and records the request", async () => {
    asRole("OFFICE_ADMIN")
    expect(await sendVenueUsageRequest("2026-09")).toEqual({ success: "Invoice request sent" })
    const mail = (sendVenueUsageRequestEmail as jest.Mock).mock.calls[0][0]
    expect(mail.to).toBe("venue@example.com")
    expect(mail.replyTo).toBe("sam@example.com")
    expect(mail.cc).toBe("sam@example.com")
    expect(mail.subject).toContain("September 2026")
    expect(mail.text).toContain("Sunday, 6 September: 5:00 PM – 8:30 PM (3.5 hours)")
    const call = (prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[0][0]
    expect(call.where).toEqual({ month: "2026-09" })
    expect(call.create).toMatchObject({ month: "2026-09", status: "SUCCESS", sentTo: "enc:venue@example.com", sentById: 7, errorMessage: null })
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_USAGE_REQUEST_SENT", "VenueUsageRequest", undefined, expect.any(Object))
  })

  it("uses venueUsage.replyToEmail as Reply-To and CCs it, deduped with ccEmail", async () => {
    asRole("ADMIN")
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({
      ...settings, ccEmail: "Office@Example.com", replyToEmail: "office@example.com",
    })
    await sendVenueUsageRequest("2026-09")
    const mail = (sendVenueUsageRequestEmail as jest.Mock).mock.calls[0][0]
    expect(mail.replyTo).toBe("office@example.com")
    expect(mail.cc).toBe("Office@Example.com, sam@example.com")
  })

  it("failure: still writes the request row with FAILED + error and returns an error", async () => {
    asRole("ADMIN")
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("SMTP down"))
    const r = await sendVenueUsageRequest("2026-09")
    expect(r).toHaveProperty("error")
    const call = (prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[0][0]
    expect(call.create).toMatchObject({ status: "FAILED", errorMessage: "SMTP down" })
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_USAGE_REQUEST_FAILED", "VenueUsageRequest", undefined, expect.any(Object))
  })

  it("resend guard: already SUCCESS needs resend=true", async () => {
    asRole("ADMIN")
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ status: "SUCCESS", sentAt: new Date(), errorMessage: null })
    expect(await sendVenueUsageRequest("2026-09")).toHaveProperty("error")
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
    expect(await sendVenueUsageRequest("2026-09", true)).toEqual({ success: "Invoice request sent" })
    expect(sendVenueUsageRequestEmail).toHaveBeenCalledTimes(1)
  })

  it("a prior FAILED request can be retried without the resend flag", async () => {
    asRole("ADMIN")
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ status: "FAILED", sentAt: new Date(), errorMessage: "x" })
    expect(await sendVenueUsageRequest("2026-09")).toEqual({ success: "Invoice request sent" })
  })

  it("is blocked in demo mode", async () => {
    asRole("ADMIN")
    ;(assertNotDemo as jest.Mock).mockReturnValue({ error: "demo" })
    expect(await sendVenueUsageRequest("2026-09")).toEqual({ error: "demo" })
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
  })
})

describe("getVenueRequestPreview", () => {
  it("gates role", async () => {
    asRole("VIEWER")
    expect(await getVenueRequestPreview("2026-09")).toEqual({ error: "Unauthorized" })
  })

  it("returns recipients, reply-to and totals", async () => {
    asRole("ADMIN")
    const p = await getVenueRequestPreview("2026-09")
    expect(p).toMatchObject({
      to: "venue@example.com", replyTo: "sam@example.com", rowCount: 1, totalHours: 3.5, blockedReason: null, last: null,
    })
  })

  it("flags a blocked month with no confirmed rows", async () => {
    asRole("ADMIN")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([])
    const p = await getVenueRequestPreview("2026-09")
    expect(p).toMatchObject({ blockedReason: "No confirmed bookings in this month" })
  })
})

describe("updateVenueUsageSettings", () => {
  const fd = (o: Record<string, string>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(o)) f.set(k, v)
    return f
  }
  const base = { enabled: "on", venueName: "Example Hall", contactName: "Pat", contactEmail: "venue@example.com", ccEmail: "", replyToEmail: "" }

  it("is ADMIN only", async () => {
    asRole("PASTOR")
    expect(await updateVenueUsageSettings(undefined, fd(base))).toEqual({ error: "Unauthorized" })
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })

  it("rejects invalid emails (contact, cc, reply-to)", async () => {
    asRole("ADMIN")
    for (const k of ["contactEmail", "ccEmail", "replyToEmail"]) {
      expect(await updateVenueUsageSettings(undefined, fd({ ...base, [k]: "not-an-email" }))).toHaveProperty("error")
    }
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })

  it("requires a contact email to enable", async () => {
    asRole("ADMIN")
    expect(await updateVenueUsageSettings(undefined, fd({ ...base, contactEmail: "" }))).toHaveProperty("error")
  })

  it("saves all keys", async () => {
    asRole("ADMIN")
    const r = await updateVenueUsageSettings(undefined, fd({ ...base, replyToEmail: "office@example.com" }))
    expect(r).toEqual({ success: "Venue usage settings saved" })
    const keys = (prisma.appSetting.upsert as jest.Mock).mock.calls.map((c) => c[0].where.key)
    expect(keys).toEqual([
      "venueUsage.enabled", "venueUsage.venueName", "venueUsage.contactName",
      "venueUsage.contactEmail", "venueUsage.ccEmail", "venueUsage.replyToEmail", "venueUsage.bookingCcEmails",
    ])
    expect((prisma.appSetting.upsert as jest.Mock).mock.calls[0][0].update.value).toBe("true")
  })
})

describe("updateVenueUsageSettings bookingCcEmails", () => {
  it("saves bookingCcEmails normalised and rejects a bad address", async () => {
    asRole("ADMIN")
    const fd = new FormData()
    fd.set("enabled", "on"); fd.set("venueName", "Example Hall"); fd.set("contactName", "Pat Example")
    fd.set("contactEmail", "venue@example.com"); fd.set("ccEmail", ""); fd.set("replyToEmail", "")
    fd.set("bookingCcEmails", "a@example.com; A@example.com, b@example.com")
    expect(await updateVenueUsageSettings(undefined, fd)).toEqual({ success: "Venue usage settings saved" })
    const calls = (prisma.appSetting.upsert as jest.Mock).mock.calls.map((c) => c[0])
    expect(calls).toContainEqual(expect.objectContaining({
      where: { key: "venueUsage.bookingCcEmails" },
      update: { value: "a@example.com, b@example.com" },
    }))
    fd.set("bookingCcEmails", "a@example.com, nope")
    expect(await updateVenueUsageSettings(undefined, fd)).toEqual({ error: '"nope" is not a valid email address' })
  })
})

describe("approval invalidation", () => {
  it("create clears an approved unsent month in the same transaction", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsageRequest.findMany as jest.Mock).mockResolvedValue([{ id: 9, month: "2026-09" }])
    const r = await createVenueUsage(validInput)
    expect(r).toEqual({ success: "Booking added", approvalCleared: true })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.venueUsageRequest.updateMany).toHaveBeenCalledWith({ where: { id: { in: [9] } }, data: { approvedAt: null, approvedById: null } })
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 7, "VENUE_APPROVAL_CLEARED", "VenueUsageRequest", 9, expect.any(Object))
  })
  it("a date move clears both the old and the new month", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findUnique as jest.Mock).mockResolvedValue({ id: 5, date: new Date("2026-08-30T00:00:00Z") })
    await updateVenueUsage(5, validInput) // 2026-09-06
    expect((prisma.venueUsageRequest.findMany as jest.Mock).mock.calls[0][0].where.month).toEqual({ in: ["2026-08", "2026-09"] })
  })
  it("delete clears the row's month", async () => {
    asRole("ADMIN")
    await deleteVenueUsage(5)
    expect((prisma.venueUsageRequest.findMany as jest.Mock).mock.calls[0][0].where.month).toEqual({ in: ["2026-09"] })
  })
  it("the approval query matches null and FAILED statuses (not only != SUCCESS)", async () => {
    asRole("PASTOR")
    await createVenueUsage(validInput)
    const where = (prisma.venueUsageRequest.findMany as jest.Mock).mock.calls[0][0].where
    expect(where.approvedAt).toEqual({ not: null })
    expect(where.OR).toEqual([{ status: null }, { status: { not: "SUCCESS" } }])
  })
  it("propagates the error (so the transaction rolls back) when the clear throws", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsageRequest.findMany as jest.Mock).mockRejectedValue(new Error("boom"))
    await expect(createVenueUsage(validInput)).rejects.toThrow("boom")
  })
})

describe("addAllSundays", () => {
  const input = { month: "2026-09", startTime: "17:00", endTime: "20:00", purpose: "Sunday service" }
  it("gates role, feature and input", async () => {
    asRole("VIEWER"); expect(await addAllSundays(input)).toEqual({ error: "Unauthorized" })
    asRole("PASTOR"); expect(await addAllSundays({ ...input, month: "2026-13" })).toEqual({ error: "Invalid month" })
    expect(await addAllSundays({ ...input, endTime: "16:00" })).toEqual({ error: "End time must be after the start time" })
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ ...settings, enabled: false })
    expect(await addAllSundays(input)).toEqual({ error: "Venue usage is not enabled" })
  })
  it("creates REQUESTED rows for Sundays without a non-cancelled row and reports skips", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([{ date: new Date("2026-09-13T00:00:00Z") }])
    ;(prisma.venueUsage.createMany as jest.Mock).mockResolvedValue({ count: 3 })
    const r = await addAllSundays(input)
    expect(r).toEqual({ success: "Added 3 Sundays (1 skipped: already booked)" })
    const where = (prisma.venueUsage.findMany as jest.Mock).mock.calls[0][0].where
    expect(where.status).toEqual({ not: "CANCELLED" })
    const data = (prisma.venueUsage.createMany as jest.Mock).mock.calls[0][0].data
    expect(data.map((d: { date: Date }) => d.date.toISOString().slice(0, 10))).toEqual(["2026-09-06", "2026-09-20", "2026-09-27"])
    expect(data.every((d: { status: string; createdById: number }) => d.status === "REQUESTED" && d.createdById === 7)).toBe(true)
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 7, "VENUE_USAGE_BULK_ADDED", "VenueUsage", undefined, { month: "2026-09", added: 3, skipped: 1 })
  })
  it("adds nothing when every Sunday is taken", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(["06", "13", "20", "27"].map((d) => ({ date: new Date(`2026-09-${d}T00:00:00Z`) })))
    expect(await addAllSundays(input)).toEqual({ success: "Nothing to add: every Sunday already has a booking" })
    expect(prisma.venueUsage.createMany).not.toHaveBeenCalled()
  })
  it("clears approval for the month it adds to", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.venueUsage.createMany as jest.Mock).mockResolvedValue({ count: 4 })
    ;(prisma.venueUsageRequest.findMany as jest.Mock).mockResolvedValue([{ id: 2, month: "2026-09" }])
    expect(await addAllSundays(input)).toMatchObject({ approvalCleared: true })
  })
})

describe("setVenueUsageStatus", () => {
  const rows = [
    { id: 1, date: new Date("2026-09-06T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "REQUESTED" },
    { id: 2, date: new Date("2026-09-13T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "CANCELLED" },
  ]
  it("gates role and validates ids", async () => {
    asRole("AUDITOR"); expect(await setVenueUsageStatus([1], "CONFIRMED")).toEqual({ error: "Unauthorized" })
    asRole("PASTOR")
    expect(await setVenueUsageStatus([], "CONFIRMED")).toEqual({ error: "Select at least one booking" })
    expect(await setVenueUsageStatus([0], "CONFIRMED")).toEqual({ error: "Invalid booking" })
    expect(await setVenueUsageStatus(Array.from({ length: 201 }, (_, i) => i + 1), "CONFIRMED")).toEqual({ error: "Too many bookings selected" })
  })
  it("updates only rows not already in the target status, audits each and clears approval", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(rows)
    ;(prisma.venueUsageRequest.findMany as jest.Mock).mockResolvedValue([{ id: 3, month: "2026-09" }])
    const r = await setVenueUsageStatus([1, 2], "CANCELLED")
    expect(r).toEqual({ success: "Cancelled 1 date", approvalCleared: true })
    expect(prisma.venueUsage.updateMany).toHaveBeenCalledWith({ where: { id: { in: [1] } }, data: { status: "CANCELLED" } })
    expect(logAuditManyTx).toHaveBeenCalledWith(prisma, [expect.objectContaining({ userId: 7, action: "VENUE_USAGE_STATUS_CHANGED", resourceId: 1 })])
  })
  it("emails the venue about cancelled dates when asked, CC booking CCs and reply-to", async () => {
    asRole("PASTOR")
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ ...settings, bookingCcEmails: "sec@example.com" })
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([rows[0]])
    await setVenueUsageStatus([1], "CANCELLED", { emailVenue: true })
    const mail = (sendVenueUsageRequestEmail as jest.Mock).mock.calls[0][0]
    expect(mail.to).toBe("venue@example.com")
    expect(mail.cc).toBe("sec@example.com, sam@example.com")
    expect(mail.replyTo).toBe("sam@example.com")
    expect(mail.subject).toBe("Booking cancellation (Example Church)")
    expect(mail.text).toContain("Sunday, 6 September")
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_CANCELLATION_EMAILED", "VenueUsage", undefined, { count: 1 })
  })
  it("keeps the cancellation and warns when the email fails", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([rows[0]])
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp"))
    const r = await setVenueUsageStatus([1], "CANCELLED", { emailVenue: true })
    expect(r).toMatchObject({ success: "Cancelled 1 date", warning: expect.stringContaining("Could not email the venue") })
    expect(prisma.venueUsage.updateMany).toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_CANCELLATION_EMAIL_FAILED", "VenueUsage", undefined, { count: 1 })
  })
  it("blocks the cancellation email in demo mode without changing anything", async () => {
    asRole("PASTOR")
    ;(assertNotDemo as jest.Mock).mockReturnValue({ error: "Not available in demo mode" })
    expect(await setVenueUsageStatus([1], "CANCELLED", { emailVenue: true })).toEqual({ error: "Not available in demo mode" })
    expect(prisma.venueUsage.updateMany).not.toHaveBeenCalled()
  })
  it("does not email for CONFIRMED", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([rows[0]])
    await setVenueUsageStatus([1], "CONFIRMED", { emailVenue: true })
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
  })
})
