/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueUsage: { findMany: jest.fn() },
    venueUsageRequest: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendVenueUsageRequestEmail: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn() }))
jest.mock("@/lib/venueUsageSettings", () => ({ readVenueUsageSettings: jest.fn() }))
jest.mock("@/lib/emailTemplateStore", () => ({ getEmailTemplate: jest.fn() }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }))

import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { encrypt } from "@/lib/crypto"
import { sendVenueUsageRequestEmail } from "@/lib/email"
import { getChurchSettings } from "@/lib/churchSettings"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { getEmailTemplate } from "@/lib/emailTemplateStore"
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates"
import { logger } from "@/lib/logger"
import {
  bookingRecipients, deliverInvoiceRequest, invoiceRecipients, loadActor, prepareInvoiceRequest,
} from "@/lib/venueInvoice"

const settings = {
  enabled: true, venueName: "Example Hall", contactName: "Pat Example", contactEmail: "venue@example.com",
  ccEmail: "treasurer@example.com", replyToEmail: "", bookingCcEmails: "sec@example.com, venue@example.com",
}
const sunday6 = { date: new Date("2026-09-06T00:00:00Z"), startTime: "17:00", endTime: "20:30", status: "CONFIRMED" }

beforeEach(() => {
  jest.resetAllMocks()
  ;(encrypt as jest.Mock).mockImplementation((v: string) => `enc:${v}`)
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue(settings)
  ;(getChurchSettings as jest.Mock).mockResolvedValue({ name: "Example Church" })
  ;(getEmailTemplate as jest.Mock).mockResolvedValue(DEFAULT_EMAIL_TEMPLATES.venueInvoiceRequest)
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([sunday6])
  ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue(null)
})

const prepare = () => prepareInvoiceRequest("2026-09", null)

describe("recipients", () => {
  it("invoiceRecipients: reply-to falls back to the actor, CC is de-duplicated and excludes the To address", () => {
    expect(invoiceRecipients(settings, { name: "Sam", email: "sam@example.com" })).toEqual({
      to: "venue@example.com", replyTo: "sam@example.com", cc: ["treasurer@example.com", "sam@example.com"],
    })
  })
  it("invoiceRecipients: CC email holds a list; each address is copied once, never the To address", () => {
    expect(invoiceRecipients({ ...settings, ccEmail: "treasurer@example.com, sec@example.com; venue@example.com" }, null))
      .toEqual({ to: "venue@example.com", replyTo: "", cc: ["treasurer@example.com", "sec@example.com"] })
  })
  it("invoiceRecipients: a stored list with a bad entry still copies the valid addresses", () => {
    expect(invoiceRecipients({ ...settings, ccEmail: "treasurer@example.com, nope" }, null).cc).toEqual(["treasurer@example.com"])
  })
  it("invoiceRecipients: scheduler (no actor) uses only the configured reply-to", () => {
    expect(invoiceRecipients({ ...settings, replyToEmail: "office@example.com" }, null))
      .toEqual({ to: "venue@example.com", replyTo: "office@example.com", cc: ["treasurer@example.com", "office@example.com"] })
    expect(invoiceRecipients(settings, null).replyTo).toBe("")
  })
  it("bookingRecipients: booking CCs plus the reply-to, never the To address", () => {
    expect(bookingRecipients(settings, { name: "Sam", email: "sam@example.com" }))
      .toEqual({ to: "venue@example.com", replyTo: "sam@example.com", cc: ["sec@example.com", "sam@example.com"] })
  })
  it("loadActor maps the user row", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ name: "Sam", email: "" })
    expect(await loadActor(7)).toEqual({ name: "Sam", email: null })
  })
})

describe("prepareInvoiceRequest", () => {
  it("lists CONFIRMED rows only but computes completeness from all rows", async () => {
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([
      sunday6,
      { date: new Date("2026-09-13T00:00:00Z"), startTime: "17:00", endTime: "20:30", status: "REQUESTED" },
    ])
    const p = await prepare()
    expect(p.rows).toHaveLength(1)
    expect(p.completeness.complete).toBe(false)
    expect(p.text).toContain("Sunday, 6 September")
    expect(p.text).not.toContain("13 September")
    expect(p.last).toBeNull()
  })

  it("uses the stored admin template (Settings edits reach real emails)", async () => {
    ;(getEmailTemplate as jest.Mock).mockResolvedValue({
      ...DEFAULT_EMAIL_TEMPLATES.venueInvoiceRequest, subject: "Custom subject {{month}}",
    })
    const p = await prepare()
    expect(getEmailTemplate).toHaveBeenCalledWith("venueInvoiceRequest")
    expect(p.subject).toContain("Custom subject")
  })

  it("maps the last request incl. approver name and autoSent", async () => {
    const sentAt = new Date()
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({
      status: "SUCCESS", sentAt, errorMessage: null, approvedAt: null, autoSent: true, approvedBy: { name: "Pat" },
    })
    expect((await prepare()).last).toEqual({
      status: "SUCCESS", sentAt, errorMessage: null, approvedAt: null, approvedByName: "Pat", autoSent: true,
    })
  })
})

describe("deliverInvoiceRequest", () => {
  it("SUCCESS stamps the request row with autoSent and audits with a null user for the scheduler", async () => {
    const p = await prepare()
    expect(await deliverInvoiceRequest(p, { month: "2026-09", userId: null, autoSent: true, resend: false }))
      .toEqual({ status: "SUCCESS", errorMessage: null, recorded: true, stale: false })
    // calls[0] is the in-flight mark; calls[1] the outcome.
    const upsert = (prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[1][0]
    expect(upsert.update).toMatchObject({ status: "SUCCESS", sentTo: "enc:venue@example.com", sentById: null, autoSent: true, sendingAt: null })
    expect(logAudit).toHaveBeenCalledWith(null, "VENUE_USAGE_REQUEST_SENT", "VenueUsageRequest", undefined, expect.objectContaining({ month: "2026-09", autoSent: true }))
  })

  it("FAILED records the error", async () => {
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    const r = await deliverInvoiceRequest(await prepare(), { month: "2026-09", userId: 7, autoSent: false, resend: false })
    expect(r).toEqual({ status: "FAILED", errorMessage: "smtp down", recorded: true, stale: false })
    expect((prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[1][0].update).toMatchObject({ status: "FAILED", errorMessage: "smtp down", sendingAt: null })
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_USAGE_REQUEST_FAILED", "VenueUsageRequest", undefined, expect.any(Object))
  })

  it("a failed RESEND after a SUCCESS keeps status SUCCESS (only errorMessage is recorded)", async () => {
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ status: "SUCCESS", sentAt: new Date(), errorMessage: null, approvedAt: null, approvedBy: null, autoSent: false })
    const p = await prepare()
    expect((await deliverInvoiceRequest(p, { month: "2026-09", userId: 7, autoSent: false, resend: true })).status).toBe("FAILED")
    expect(prisma.venueUsageRequest.upsert).toHaveBeenCalledTimes(1) // only the in-flight mark
    expect((prisma.venueUsageRequest.update as jest.Mock).mock.calls[0][0]).toEqual({ where: { month: "2026-09" }, data: { errorMessage: "smtp down", sendingAt: null } })
  })

  it("'sent' means status SUCCESS, not sentAt: a prior FAILED (sentAt set) is overwritten normally", async () => {
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ status: "FAILED", sentAt: new Date(), errorMessage: "old", approvedAt: null, approvedBy: null, autoSent: false })
    const p = await prepare()
    await deliverInvoiceRequest(p, { month: "2026-09", userId: 7, autoSent: false, resend: false })
    expect(prisma.venueUsageRequest.update).not.toHaveBeenCalled()
    expect((prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[1][0].update).toMatchObject({ status: "FAILED", errorMessage: "smtp down" })
  })
})

describe("deliverInvoiceRequest after the email has gone", () => {
  const upsert = () => prisma.venueUsageRequest.upsert as jest.Mock
  const ctx = { month: "2026-09", userId: null, autoSent: true, resend: false }

  it("retries the success write once and still reports SUCCESS", async () => {
    upsert().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("db blip")).mockResolvedValueOnce({})
    expect(await deliverInvoiceRequest(await prepare(), ctx)).toEqual({ status: "SUCCESS", errorMessage: null, recorded: true, stale: false })
    expect(sendVenueUsageRequestEmail).toHaveBeenCalledTimes(1)
    expect(upsert()).toHaveBeenCalledTimes(3)
    expect(upsert().mock.calls[2][0].update).toMatchObject({ status: "SUCCESS" })
  })

  it("a success write that fails twice is logged loudly (no PII) and never throws or reports FAILED", async () => {
    upsert().mockResolvedValueOnce({}).mockRejectedValue(new Error("db down"))
    expect(await deliverInvoiceRequest(await prepare(), ctx)).toEqual({ status: "SUCCESS", errorMessage: null, recorded: false, stale: false })
    expect(upsert()).toHaveBeenCalledTimes(3)
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/venueInvoice.*not recorded/), expect.objectContaining({ month: "2026-09", error: "db down" }))
    expect(JSON.stringify((logger.error as jest.Mock).mock.calls)).not.toContain("venue@example.com")
  })

  it("an audit failure never propagates (SUCCESS or FAILED)", async () => {
    ;(logAudit as jest.Mock).mockRejectedValue(new Error("audit down"))
    expect((await deliverInvoiceRequest(await prepare(), ctx)).status).toBe("SUCCESS")
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    expect((await deliverInvoiceRequest(await prepare(), ctx)).status).toBe("FAILED")
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/venueInvoice.*audit/), expect.any(Object))
  })
})

describe("deliverInvoiceRequest in-flight window (#509 #512)", () => {
  const upsert = () => prisma.venueUsageRequest.upsert as jest.Mock
  const findMany = () => prisma.venueUsage.findMany as jest.Mock
  const ctx = { month: "2026-09", userId: 7, autoSent: false, resend: false }

  it("marks the request in flight (sendingAt) before the email goes", async () => {
    const p = await prepare()
    const order: string[] = []
    upsert().mockImplementation(async (a: { update: Record<string, unknown> }) => { order.push("status" in a.update ? "outcome" : "mark"); return {} })
    ;(sendVenueUsageRequestEmail as jest.Mock).mockImplementation(async () => { order.push("send") })
    await deliverInvoiceRequest(p, ctx)
    expect(order).toEqual(["mark", "send", "outcome"])
    expect(upsert().mock.calls[0][0]).toEqual({
      where: { month: "2026-09" }, create: { month: "2026-09", sendingAt: expect.any(Date) }, update: { sendingAt: expect.any(Date) },
    })
  })

  it("a failed in-flight mark is logged and the email still goes (best-effort; e.g. code deployed before migrate)", async () => {
    upsert().mockRejectedValueOnce(new Error("no column sendingAt")).mockResolvedValue({})
    expect((await deliverInvoiceRequest(await prepare(), ctx)).status).toBe("SUCCESS")
    expect(sendVenueUsageRequestEmail).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/venueInvoice.*in-flight/), expect.objectContaining({ month: "2026-09" }))
  })

  it("records the SUCCESS outcome before the post-send re-check reads the month", async () => {
    const p = await prepare()
    const order: string[] = []
    upsert().mockImplementation(async (a: { update: Record<string, unknown> }) => { order.push("status" in a.update ? "outcome" : "mark"); return {} })
    findMany().mockImplementation(async () => { order.push("recheck"); return [sunday6] })
    await deliverInvoiceRequest(p, ctx)
    expect(order).toEqual(["mark", "outcome", "recheck"])
  })

  it("clears sendingAt (best-effort) when the outcome write throws", async () => {
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    const p = await prepare()
    upsert().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("db down"))
    await expect(deliverInvoiceRequest(p, ctx)).rejects.toThrow("db down")
    expect(prisma.venueUsageRequest.updateMany).toHaveBeenCalledWith({ where: { month: "2026-09" }, data: { sendingAt: null } })
  })

  it("clears sendingAt when a SUCCESS could not be recorded, and a failing clear never throws", async () => {
    const p = await prepare()
    upsert().mockResolvedValueOnce({}).mockRejectedValue(new Error("db down"))
    ;(prisma.venueUsageRequest.updateMany as jest.Mock).mockRejectedValue(new Error("still down"))
    expect(await deliverInvoiceRequest(p, ctx)).toMatchObject({ status: "SUCCESS", recorded: false })
    expect(prisma.venueUsageRequest.updateMany).toHaveBeenCalledWith({ where: { month: "2026-09" }, data: { sendingAt: null } })
  })

  it("does not clear sendingAt separately once the outcome write did it", async () => {
    await deliverInvoiceRequest(await prepare(), ctx)
    expect(prisma.venueUsageRequest.updateMany).not.toHaveBeenCalled()
  })

  it("reports stale when the month's CONFIRMED rows changed while sending, and audits it", async () => {
    const p = await prepare()
    findMany().mockResolvedValueOnce([{ ...sunday6, endTime: "21:00" }])
    expect(await deliverInvoiceRequest(p, ctx)).toEqual({ status: "SUCCESS", errorMessage: null, recorded: true, stale: true })
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/venueInvoice.*changed while/), { month: "2026-09" })
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_USAGE_REQUEST_SENT", "VenueUsageRequest", undefined, expect.objectContaining({ stale: true }))
  })

  it("is not stale when only non-CONFIRMED rows changed", async () => {
    const p = await prepare()
    findMany().mockResolvedValueOnce([sunday6, { ...sunday6, date: new Date("2026-09-13T00:00:00Z"), status: "REQUESTED" }])
    expect((await deliverInvoiceRequest(p, ctx)).stale).toBe(false)
  })

  it("a failing re-check never fails the send (logged, stale false)", async () => {
    const p = await prepare()
    findMany().mockRejectedValueOnce(new Error("db blip"))
    expect(await deliverInvoiceRequest(p, ctx)).toEqual({ status: "SUCCESS", errorMessage: null, recorded: true, stale: false })
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/venueInvoice.*re-check/), expect.objectContaining({ month: "2026-09" }))
  })

  it("does not re-check a FAILED send", async () => {
    const p = await prepare()
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    findMany().mockClear()
    await deliverInvoiceRequest(p, ctx)
    expect(findMany()).not.toHaveBeenCalled()
  })
})

it("prepareInvoiceRequest warns when the month read hits the row cap", async () => {
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(Array.from({ length: 200 }, () => sunday6))
  await prepare()
  expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/venueInvoice.*cap/), expect.objectContaining({ month: "2026-09", cap: 200 }))
})
