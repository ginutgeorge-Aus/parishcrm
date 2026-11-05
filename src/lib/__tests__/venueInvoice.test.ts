/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueUsage: { findMany: jest.fn(), aggregate: jest.fn() },
    venueUsageRequest: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
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
import { totalHours } from "@/lib/venueUsage"
import { sendVenueUsageRequestEmail } from "@/lib/email"
import { getChurchSettings } from "@/lib/churchSettings"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { getEmailTemplate } from "@/lib/emailTemplateStore"
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates"
import { logger } from "@/lib/logger"
import {
  bookingRecipients, deliverInvoiceRequest, INVOICE_ALREADY_SENT_ERROR, INVOICE_CLAIM_CONFLICT_ERROR, INVOICE_CLAIM_FAILED_ERROR,
  INVOICE_ROWS_CHANGED_ERROR, INVOICE_SEND_BUSY_ERROR, invoiceRecipients, loadActor, prepareInvoiceRequest,
} from "@/lib/venueInvoice"
import { VENUE_SENDING_WARNING_TTL_MS } from "@/lib/venueApproval"

const settings = {
  enabled: true, venueName: "Example Hall", contactName: "Pat Example", contactEmail: "venue@example.com",
  ccEmail: "treasurer@example.com", replyToEmail: "", bookingCcEmails: "sec@example.com, venue@example.com",
}
const sunday6 = { date: new Date("2026-09-06T00:00:00Z"), startTime: "17:00", endTime: "20:30", status: "CONFIRMED", updatedAt: new Date("2026-08-01T00:00:00Z") }
/** The aggregate the claim and post-send re-check read, as it looks for `rows` (CONFIRMED only). */
const versionOf = (rows: { status: string; updatedAt: Date }[]) => {
  const c = rows.filter((r) => r.status === "CONFIRMED")
  return { _count: { _all: c.length }, _max: { updatedAt: c.length ? new Date(Math.max(...c.map((r) => r.updatedAt.getTime()))) : null } }
}
const aggregate = () => prisma.venueUsage.aggregate as jest.Mock

beforeEach(() => {
  jest.resetAllMocks()
  ;(encrypt as jest.Mock).mockImplementation((v: string) => `enc:${v}`)
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue(settings)
  ;(getChurchSettings as jest.Mock).mockResolvedValue({ name: "Example Church" })
  ;(getEmailTemplate as jest.Mock).mockResolvedValue(DEFAULT_EMAIL_TEMPLATES.venueInvoiceRequest)
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([sunday6])
  aggregate().mockResolvedValue(versionOf([sunday6]))
  ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue(null)
  // The send claim runs in a Serializable transaction; run its body against the same mocked client.
  ;(prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma))
})

const prepare = () => prepareInvoiceRequest("2026-09", null)
const SNAP = { rowCount: 1, hours: 3.5 }

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
      .toEqual({ status: "SUCCESS", errorMessage: null, recorded: true, stale: false, snapshot: SNAP })
    // calls[0] is the in-flight mark; calls[1] the outcome.
    const upsert = (prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[1][0]
    expect(upsert.update).toMatchObject({ status: "SUCCESS", sentTo: "enc:venue@example.com", sentById: null, autoSent: true, sendingAt: null })
    expect(logAudit).toHaveBeenCalledWith(null, "VENUE_USAGE_REQUEST_SENT", "VenueUsageRequest", undefined, expect.objectContaining({ month: "2026-09", autoSent: true }))
  })

  it("FAILED records the error", async () => {
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    const r = await deliverInvoiceRequest(await prepare(), { month: "2026-09", userId: 7, autoSent: false, resend: false })
    expect(r).toEqual({ status: "FAILED", errorMessage: "smtp down", recorded: true, stale: false, snapshot: SNAP })
    expect((prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[1][0].update).toMatchObject({ status: "FAILED", errorMessage: "smtp down" })
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
    expect(await deliverInvoiceRequest(await prepare(), ctx)).toEqual({ status: "SUCCESS", errorMessage: null, recorded: true, stale: false, snapshot: SNAP })
    expect(sendVenueUsageRequestEmail).toHaveBeenCalledTimes(1)
    expect(upsert()).toHaveBeenCalledTimes(3)
    expect(upsert().mock.calls[2][0].update).toMatchObject({ status: "SUCCESS" })
  })

  it("a success write that fails twice is logged loudly (no PII) and never throws or reports FAILED", async () => {
    upsert().mockResolvedValueOnce({}).mockRejectedValue(new Error("db down"))
    expect(await deliverInvoiceRequest(await prepare(), ctx)).toEqual({ status: "SUCCESS", errorMessage: null, recorded: false, stale: false, snapshot: SNAP })
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

  it("the claim and the post-send re-check use the cheap version check, not a whole-month read (#536)", async () => {
    const p = await prepare()
    ;(prisma.venueUsage.findMany as jest.Mock).mockClear()
    await deliverInvoiceRequest(p, ctx)
    expect(prisma.venueUsage.findMany).not.toHaveBeenCalled()
    expect(aggregate()).toHaveBeenCalledTimes(2)
    expect(aggregate().mock.calls[0][0]).toMatchObject({ where: { status: "CONFIRMED" }, _count: { _all: true }, _max: { updatedAt: true } })
  })

  it("a claim that fails with a non-conflict error (timeout, dropped connection) refuses: nothing sent", async () => {
    upsert().mockRejectedValueOnce(new Error("connection terminated")).mockResolvedValue({})
    expect(await deliverInvoiceRequest(await prepare(), ctx)).toEqual({ status: "BUSY", errorMessage: INVOICE_CLAIM_FAILED_ERROR, recorded: false, stale: false, snapshot: SNAP })
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/venueInvoice.*could not claim/), expect.objectContaining({ month: "2026-09" }))
  })

  it("records the SUCCESS outcome before the post-send re-check reads the month", async () => {
    const p = await prepare()
    const order: string[] = []
    upsert().mockImplementation(async (a: { update: Record<string, unknown> }) => { order.push("status" in a.update ? "outcome" : "mark"); return {} })
    aggregate().mockImplementation(async () => { order.push("read"); return versionOf([sunday6]) })
    await deliverInvoiceRequest(p, ctx)
    // The claim's read comes before the mark (same transaction); the re-check after the outcome.
    expect(order).toEqual(["read", "mark", "outcome", "read"])
  })

  it("clears sendingAt (best-effort) when the outcome write throws", async () => {
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    const p = await prepare()
    upsert().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("db down"))
    await expect(deliverInvoiceRequest(p, ctx)).rejects.toThrow("db down")
    expect(prisma.venueUsageRequest.updateMany).toHaveBeenCalledWith({ where: { month: "2026-09", sendingAt: expect.any(Date) }, data: { sendingAt: null } })
  })

  it("clears sendingAt when a SUCCESS could not be recorded, and a failing clear never throws", async () => {
    const p = await prepare()
    upsert().mockResolvedValueOnce({}).mockRejectedValue(new Error("db down"))
    ;(prisma.venueUsageRequest.updateMany as jest.Mock).mockRejectedValue(new Error("still down"))
    expect(await deliverInvoiceRequest(p, ctx)).toMatchObject({ status: "SUCCESS", recorded: false })
    expect(prisma.venueUsageRequest.updateMany).toHaveBeenCalledWith({ where: { month: "2026-09", sendingAt: expect.any(Date) }, data: { sendingAt: null } })
  })

  it("the outcome write clears the stamp itself; no separate clear", async () => {
    await deliverInvoiceRequest(await prepare(), ctx)
    expect(upsert().mock.calls[1][0].update).toMatchObject({ status: "SUCCESS", sendingAt: null })
    expect(prisma.venueUsageRequest.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { sendingAt: null } }))
  })

  it("a fallback clear is fenced on this send's own stamp (#528)", async () => {
    const p = await prepare()
    upsert().mockResolvedValueOnce({}).mockRejectedValue(new Error("db down"))
    await deliverInvoiceRequest(p, ctx)
    const stamp = upsert().mock.calls[0][0].update.sendingAt as Date
    expect(prisma.venueUsageRequest.updateMany).toHaveBeenCalledWith({ where: { month: "2026-09", sendingAt: stamp }, data: { sendingAt: null } })
  })

  it("reports stale when the month's CONFIRMED rows changed while sending, and audits it", async () => {
    const p = await prepare()
    aggregate().mockResolvedValueOnce(versionOf([sunday6])).mockResolvedValueOnce(versionOf([{ ...sunday6, updatedAt: new Date("2026-09-01T00:00:00Z") }]))
    expect(await deliverInvoiceRequest(p, ctx)).toEqual({ status: "SUCCESS", errorMessage: null, recorded: true, stale: true, snapshot: SNAP })
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/venueInvoice.*changed while/), { month: "2026-09" })
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_USAGE_REQUEST_SENT", "VenueUsageRequest", undefined, expect.objectContaining({ stale: true }))
  })

  it("the SENT audit row carries this send's sentAt, so the job can tell a finished stale check from a lost one (#550)", async () => {
    const p = await prepare()
    await deliverInvoiceRequest(p, ctx)
    const sentAt = upsert().mock.calls.at(-1)[0].update.sentAt as Date
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_USAGE_REQUEST_SENT", "VenueUsageRequest", undefined, expect.objectContaining({ sentAt: sentAt.toISOString() }))
  })

  it("SUCCESS outcome write carries staleAt null + the sent snapshot; only a fenced update sets staleAt when stale (#549)", async () => {
    const p = await prepare()
    aggregate().mockResolvedValueOnce(versionOf([sunday6])).mockResolvedValueOnce(versionOf([{ ...sunday6, updatedAt: new Date("2026-09-01T00:00:00Z") }]))
    await deliverInvoiceRequest(p, ctx)
    const snap = { staleAt: null, sentRowCount: p.rows.length, sentHours: totalHours(p.rows) }
    const call = upsert().mock.calls[1][0]
    expect(call.update).toMatchObject(snap)
    expect(call.create).toMatchObject(snap)
    expect(prisma.venueUsageRequest.updateMany).toHaveBeenCalledWith({ where: { month: "2026-09", sentAt: call.update.sentAt }, data: { staleAt: expect.any(Date) } })
  })

  it("no staleAt update when the send was not stale", async () => {
    const p = await prepare()
    await deliverInvoiceRequest(p, ctx)
    expect(prisma.venueUsageRequest.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ staleAt: expect.anything() }) }))
  })

  it("retries the staleAt write once, and a failing write never fails the send", async () => {
    const p = await prepare()
    aggregate().mockResolvedValueOnce(versionOf([sunday6])).mockResolvedValueOnce(versionOf([{ ...sunday6, updatedAt: new Date("2026-09-01T00:00:00Z") }]))
    ;(prisma.venueUsageRequest.updateMany as jest.Mock).mockRejectedValue(new Error("db blip"))
    expect(await deliverInvoiceRequest(p, ctx)).toEqual({ status: "SUCCESS", errorMessage: null, recorded: true, stale: true, snapshot: SNAP })
    expect(prisma.venueUsageRequest.updateMany).toHaveBeenCalledTimes(2)
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/staleAt write failed/), expect.objectContaining({ month: "2026-09" }))
  })

  it("no staleAt update when the SUCCESS could not be recorded", async () => {
    const p = await prepare()
    aggregate().mockResolvedValueOnce(versionOf([sunday6])).mockResolvedValueOnce(versionOf([{ ...sunday6, updatedAt: new Date("2026-09-01T00:00:00Z") }]))
    upsert().mockResolvedValueOnce({}).mockRejectedValue(new Error("db down"))
    await deliverInvoiceRequest(p, ctx)
    expect(prisma.venueUsageRequest.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ staleAt: expect.anything() }) }))
  })

  it("an unrecorded SUCCESS over an earlier SUCCESS replaces that send's flag and snapshot, fenced on its sentAt (#549)", async () => {
    const earlier = new Date("2026-09-02T00:00:00Z")
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ status: "SUCCESS", sentAt: earlier, errorMessage: null, approvedAt: null, autoSent: false, approvedBy: null })
    const p = await prepare()
    aggregate().mockResolvedValueOnce(versionOf([sunday6])).mockResolvedValueOnce(versionOf([{ ...sunday6, updatedAt: new Date("2026-09-01T00:00:00Z") }]))
    upsert().mockResolvedValueOnce({}).mockRejectedValue(new Error("db down"))
    await deliverInvoiceRequest(p, { ...ctx, resend: true })
    expect(prisma.venueUsageRequest.updateMany).toHaveBeenCalledWith({
      where: { month: "2026-09", status: "SUCCESS", sentAt: earlier },
      data: { staleAt: expect.any(Date), sentAt: expect.any(Date), sentTo: expect.anything(), sentById: ctx.userId, autoSent: ctx.autoSent, sentRowCount: SNAP.rowCount, sentHours: SNAP.hours },
    })
  })

  it("the replace-snapshot write also moves the row's sentAt to this send, matching the audit row (#550)", async () => {
    const earlier = new Date("2026-09-02T00:00:00Z")
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ status: "SUCCESS", sentAt: earlier, errorMessage: null, approvedAt: null, autoSent: false, approvedBy: null })
    const p = await prepare()
    upsert().mockResolvedValueOnce({}).mockRejectedValue(new Error("db down"))
    await deliverInvoiceRequest(p, { ...ctx, resend: true })
    const replaced = (prisma.venueUsageRequest.updateMany as jest.Mock).mock.calls.find((c) => c[0].where.sentAt === earlier)![0].data.sentAt as Date
    const auditMeta = (logAudit as jest.Mock).mock.calls.find((c) => c[1] === "VENUE_USAGE_REQUEST_SENT")![4]
    expect(auditMeta.sentAt).toBe(replaced.toISOString())
  })

  it("is not stale when only non-CONFIRMED rows changed", async () => {
    const p = await prepare()
    aggregate().mockResolvedValueOnce(versionOf([sunday6, { ...sunday6, status: "REQUESTED", updatedAt: new Date("2026-09-01T00:00:00Z") }]))
    expect((await deliverInvoiceRequest(p, ctx)).stale).toBe(false)
  })

  it("a failing re-check never fails the send (logged, stale false)", async () => {
    const p = await prepare()
    aggregate().mockResolvedValueOnce(versionOf([sunday6])).mockRejectedValueOnce(new Error("db blip"))
    expect(await deliverInvoiceRequest(p, ctx)).toEqual({ status: "SUCCESS", errorMessage: null, recorded: true, stale: false, snapshot: SNAP })
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/venueInvoice.*re-check/), expect.objectContaining({ month: "2026-09" }))
  })

  it("a failing re-check leaves sentAt out of the SENT audit row and flags it, so the retry re-derives (#550)", async () => {
    const p = await prepare()
    aggregate().mockResolvedValueOnce(versionOf([sunday6])).mockRejectedValueOnce(new Error("db blip"))
    await deliverInvoiceRequest(p, ctx)
    const meta = (logAudit as jest.Mock).mock.calls.find((c) => c[1] === "VENUE_USAGE_REQUEST_SENT")![4]
    expect(meta).toMatchObject({ recheckFailed: true })
    expect(meta).not.toHaveProperty("sentAt")
  })

  it("does not re-check a FAILED send", async () => {
    const p = await prepare()
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    aggregate().mockClear()
    await deliverInvoiceRequest(p, ctx)
    expect(aggregate()).toHaveBeenCalledTimes(1) // the claim's read only
  })
})

describe("deliverInvoiceRequest send claim (#528 #509 #512)", () => {
  const upsert = () => prisma.venueUsageRequest.upsert as jest.Mock
  const findUnique = () => prisma.venueUsageRequest.findUnique as jest.Mock
  const ctx = { month: "2026-09", userId: 7, autoSent: false, resend: false }
  const busy = { status: "BUSY", errorMessage: INVOICE_SEND_BUSY_ERROR, recorded: false, stale: false, snapshot: SNAP }
  const refused = (errorMessage: string) => ({ status: "BUSY", errorMessage, recorded: false, stale: false, snapshot: SNAP })
  const p2034 = () => Object.assign(new Error("serialization failure"), { code: "P2034" })

  it("refuses a second send while another send's stamp is live: nothing sent, recorded or audited", async () => {
    const p = await prepare()
    findUnique().mockResolvedValueOnce({ sendingAt: new Date(Date.now() - 30_000) })
    expect(await deliverInvoiceRequest(p, ctx)).toEqual(busy)
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
    expect(upsert()).not.toHaveBeenCalled()
    expect(prisma.venueUsageRequest.updateMany).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("takes over a stamp older than the in-flight TTL (a send that died mid-way)", async () => {
    const p = await prepare()
    findUnique().mockResolvedValueOnce({ sendingAt: new Date(Date.now() - VENUE_SENDING_WARNING_TTL_MS - 1000) })
    expect((await deliverInvoiceRequest(p, ctx)).status).toBe("SUCCESS")
    expect(sendVenueUsageRequestEmail).toHaveBeenCalledTimes(1)
  })

  it("runs the claim Serializable and refuses when it keeps conflicting (a racing send or edit)", async () => {
    const p = await prepare()
    ;(prisma.$transaction as jest.Mock).mockRejectedValue(p2034())
    expect(await deliverInvoiceRequest(p, ctx)).toEqual(refused(INVOICE_CLAIM_CONFLICT_ERROR))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/claim kept conflicting/), { month: "2026-09" })
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" })
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
  })

  it("retries a single serialization conflict and then sends", async () => {
    const p = await prepare()
    const run = (fn: (tx: typeof prisma) => unknown) => fn(prisma)
    ;(prisma.$transaction as jest.Mock).mockRejectedValueOnce(p2034()).mockImplementation(run)
    expect((await deliverInvoiceRequest(p, ctx)).status).toBe("SUCCESS")
  })

  it("refuses when a racing first send inserted the row first (unique month)", async () => {
    const p = await prepare()
    upsert().mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
    expect(await deliverInvoiceRequest(p, ctx)).toEqual(busy)
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
  })

  it("refuses (nothing sent or stamped) when an edit committed between prepare and the claim", async () => {
    const p = await prepare()
    ;aggregate().mockResolvedValueOnce(versionOf([{ ...sunday6, updatedAt: new Date("2026-09-01T00:00:00Z") }]))
    expect(await deliverInvoiceRequest(p, ctx)).toEqual(refused(INVOICE_ROWS_CHANGED_ERROR))
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
    expect(upsert()).not.toHaveBeenCalled()
  })

  it("the job after a manual send finished before its prepare (p.last already SUCCESS, not a resend) is refused", async () => {
    findUnique().mockResolvedValue({ status: "SUCCESS", sentAt: new Date("2026-10-02T00:00:00Z"), errorMessage: null, approvedAt: null, approvedBy: null, autoSent: false, sendingAt: null })
    const p = await prepare()
    expect(await deliverInvoiceRequest(p, { month: "2026-09", userId: null, autoSent: true, resend: false }))
      .toEqual(refused(INVOICE_ALREADY_SENT_ERROR))
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
  })

  it("refuses a second click that arrives after the first send finished (SUCCESS since prepare)", async () => {
    const p = await prepare() // prepared while the month was unsent
    findUnique().mockResolvedValueOnce({ sendingAt: null, status: "SUCCESS", sentAt: new Date() })
    expect(await deliverInvoiceRequest(p, ctx)).toEqual(refused(INVOICE_ALREADY_SENT_ERROR))
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
  })

  it("an explicit resend still goes when no other send landed since it was prepared", async () => {
    const sentAt = new Date("2026-10-02T00:00:00Z")
    findUnique().mockResolvedValue({ status: "SUCCESS", sentAt, errorMessage: null, approvedAt: null, approvedBy: null, autoSent: false, sendingAt: null })
    const p = await prepare()
    expect((await deliverInvoiceRequest(p, { ...ctx, resend: true })).status).toBe("SUCCESS")
  })

  it("a second resend prepared before the first one finished is refused (sentAt moved)", async () => {
    findUnique().mockResolvedValue({ status: "SUCCESS", sentAt: new Date("2026-10-02T00:00:00Z"), errorMessage: null, approvedAt: null, approvedBy: null, autoSent: false })
    const p = await prepare()
    findUnique().mockResolvedValueOnce({ sendingAt: null, status: "SUCCESS", sentAt: new Date("2026-11-03T00:00:00Z") })
    expect(await deliverInvoiceRequest(p, { ...ctx, resend: true })).toEqual(refused(INVOICE_ALREADY_SENT_ERROR))
  })
})

it("prepareInvoiceRequest warns when the month read hits the row cap", async () => {
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(Array.from({ length: 200 }, () => sunday6))
  await prepare()
  expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/venueInvoice.*cap/), expect.objectContaining({ month: "2026-09", cap: 200 }))
})
