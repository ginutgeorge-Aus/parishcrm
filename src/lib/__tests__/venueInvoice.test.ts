/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueUsage: { findMany: jest.fn() },
    venueUsageRequest: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendVenueUsageRequestEmail: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn() }))
jest.mock("@/lib/venueUsageSettings", () => ({ readVenueUsageSettings: jest.fn() }))
jest.mock("@/lib/emailTemplateStore", () => ({ getEmailTemplate: jest.fn() }))

import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { encrypt } from "@/lib/crypto"
import { sendVenueUsageRequestEmail } from "@/lib/email"
import { getChurchSettings } from "@/lib/churchSettings"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { getEmailTemplate } from "@/lib/emailTemplateStore"
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates"
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
      .toEqual({ status: "SUCCESS", errorMessage: null })
    const upsert = (prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[0][0]
    expect(upsert.update).toMatchObject({ status: "SUCCESS", sentTo: "enc:venue@example.com", sentById: null, autoSent: true })
    expect(logAudit).toHaveBeenCalledWith(null, "VENUE_USAGE_REQUEST_SENT", "VenueUsageRequest", undefined, expect.objectContaining({ month: "2026-09", autoSent: true }))
  })

  it("FAILED records the error", async () => {
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    const r = await deliverInvoiceRequest(await prepare(), { month: "2026-09", userId: 7, autoSent: false, resend: false })
    expect(r).toEqual({ status: "FAILED", errorMessage: "smtp down" })
    expect((prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[0][0].update).toMatchObject({ status: "FAILED", errorMessage: "smtp down" })
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_USAGE_REQUEST_FAILED", "VenueUsageRequest", undefined, expect.any(Object))
  })

  it("a failed RESEND after a SUCCESS keeps status SUCCESS (only errorMessage is recorded)", async () => {
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ status: "SUCCESS", sentAt: new Date(), errorMessage: null, approvedAt: null, approvedBy: null, autoSent: false })
    const p = await prepare()
    expect((await deliverInvoiceRequest(p, { month: "2026-09", userId: 7, autoSent: false, resend: true })).status).toBe("FAILED")
    expect(prisma.venueUsageRequest.upsert).not.toHaveBeenCalled()
    expect((prisma.venueUsageRequest.update as jest.Mock).mock.calls[0][0]).toEqual({ where: { month: "2026-09" }, data: { errorMessage: "smtp down" } })
  })

  it("'sent' means status SUCCESS, not sentAt: a prior FAILED (sentAt set) is overwritten normally", async () => {
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ status: "FAILED", sentAt: new Date(), errorMessage: "old", approvedAt: null, approvedBy: null, autoSent: false })
    const p = await prepare()
    await deliverInvoiceRequest(p, { month: "2026-09", userId: 7, autoSent: false, resend: false })
    expect(prisma.venueUsageRequest.update).not.toHaveBeenCalled()
    expect((prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[0][0].update).toMatchObject({ status: "FAILED", errorMessage: "smtp down" })
  })
})
