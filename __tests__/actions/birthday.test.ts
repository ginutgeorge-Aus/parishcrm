/** @jest-environment node */
import { sendBirthdayEmail, sendBirthdayEmailsBulk } from "@/lib/actions/birthday"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    person: { findUnique: jest.fn(), findMany: jest.fn() },
    celebrationSend: { create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  },
}))
jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn(),
  isAmbiguousDeliveryError: (e: unknown) =>
    typeof (e as { code?: string })?.code === "string" &&
    ["ETIMEDOUT", "ECONNRESET", "ESOCKET", "EPIPE"].includes((e as { code: string }).code),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => {
    if (v === "enc:__CORRUPT__") throw new Error("Unsupported state or unable to authenticate data")
    return v.replace(/^enc:/, "")
  }),
}))
jest.mock("@/lib/actions/settings", () => ({
  getBirthdayTemplate: jest.fn().mockResolvedValue({ subject: "Hi {firstName}", body: "Bless {them} and {their} family" }),
}))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn().mockResolvedValue({ name: "Test Church", address: "", abn: "", email: "", website: "" }),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { decrypt } from "@/lib/crypto"

const admin = { user: { role: "ADMIN", id: "1" } }
const create = prisma.celebrationSend.create as jest.Mock
const updateManyClaim = prisma.celebrationSend.updateMany as jest.Mock

// Freeze to a fixed mid-month/mid-FY date so birthday-window assertions derived
// from `new Date()` don't drift across day/FY boundaries during a run.
beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-06-01T00:00:00Z") })
  create.mockResolvedValue({ id: 1 })
  updateManyClaim.mockResolvedValue({ count: 0 })
})
afterEach(() => jest.useRealTimers())

describe("sendBirthdayEmail", () => {
  beforeEach(() => jest.clearAllMocks())

  it("rejects unauthorized role", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "VIEWER", id: "3" } })
    expect(await sendBirthdayEmail(5)).toEqual({ error: "Unauthorized" })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("rejects when consent is false", async () => {
    ;(auth as jest.Mock).mockResolvedValue(admin)
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({
      id: 5, firstName: "Jon", email: "enc:jon@x.com", emailConsent: false, archivedAt: null,
    })
    expect(await sendBirthdayEmail(5)).toEqual({ error: "Member has not consented to email" })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("rejects when no email", async () => {
    ;(auth as jest.Mock).mockResolvedValue(admin)
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({
      id: 5, firstName: "Jon", email: null, emailConsent: true, archivedAt: null,
    })
    expect(await sendBirthdayEmail(5)).toEqual({ error: "Member has no email address" })
  })

  it("returns a clean error (no throw) when the email ciphertext is corrupt", async () => {
    ;(auth as jest.Mock).mockResolvedValue(admin)
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({
      id: 5, firstName: "Jon", email: "enc:__CORRUPT__", emailConsent: true, archivedAt: null,
    })
    const result = await sendBirthdayEmail(5)
    expect(result).toEqual({ error: expect.stringContaining("could not be read") })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("sends and audits on happy path", async () => {
    ;(auth as jest.Mock).mockResolvedValue(admin)
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({
      id: 5, firstName: "Jon", email: "enc:jon@x.com", emailConsent: true, archivedAt: null,
    })
    const res = await sendBirthdayEmail(5)
    expect(sendEmail).toHaveBeenCalledWith("jon@x.com", "Hi Jon", expect.any(String), "Bless them and their family")
    expect(res).toEqual({ success: "Birthday email sent to Jon" })
  })

  it(" an ambiguous post-submission send failure marks the slot UNKNOWN (terminal), not a retryable FAILED", async () => {
    ;(auth as jest.Mock).mockResolvedValue(admin)
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({
      id: 5, firstName: "Jon", email: "enc:jon@x.com", emailConsent: true, archivedAt: null,
    })
    ;(sendEmail as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { code: "ESOCKET" }))
    const res = await sendBirthdayEmail(5)
    expect(res).toEqual({ error: "Email delivery failed" })
    expect(prisma.celebrationSend.update as jest.Mock).toHaveBeenCalledWith({
      where: { personId_action_sendDate: { personId: 5, action: "BIRTHDAY_EMAIL_SENT", sendDate: expect.any(String) } },
      data: { status: "UNKNOWN" },
    })
    expect(prisma.celebrationSend.update as jest.Mock).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: "FAILED" } }))
  })

  it(" rejects when a claim collision shows the person was already emailed today", async () => {
    ;(auth as jest.Mock).mockResolvedValue(admin)
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({
      id: 5, firstName: "Jon", email: "enc:jon@x.com", emailConsent: true, archivedAt: null,
    })
    create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))
    updateManyClaim.mockResolvedValue({ count: 0 }) // no FAILED slot to reclaim
    const res = await sendBirthdayEmail(5)
    expect(res).toEqual({ error: "A birthday email was already sent to Jon today" })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe("sendBirthdayEmailsBulk", () => {
  beforeEach(() => jest.clearAllMocks())

  it("rejects unauthorized", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "VIEWER", id: "3" } })
    expect(await sendBirthdayEmailsBulk(7)).toEqual({ error: "Unauthorized" })
  })

  it("rejects invalid window", async () => {
    ;(auth as jest.Mock).mockResolvedValue(admin)
    expect(await sendBirthdayEmailsBulk(99)).toEqual({ error: "Invalid window" })
  })

  it("sends to consenting upcoming members and skips the rest", async () => {
    ;(auth as jest.Mock).mockResolvedValue(admin)
    const today = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const soon = new Date(today.getFullYear() - 30, today.getMonth(), today.getDate())
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue([
      { id: 1, firstName: "A", email: "enc:a@x.com", emailConsent: true, archivedAt: null, dateOfBirth: `enc:${iso(soon)}`, family: { name: "F" } },
      { id: 2, firstName: "B", email: "enc:b@x.com", emailConsent: false, archivedAt: null, dateOfBirth: `enc:${iso(soon)}`, family: { name: "F" } },
      { id: 3, firstName: "C", email: null, emailConsent: true, archivedAt: null, dateOfBirth: `enc:${iso(soon)}`, family: { name: "F" } },
    ])
    const res = await sendBirthdayEmailsBulk(7)
    expect(res).toEqual({ sent: 1, skipped: 2, failed: 0 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it("skips a member with an undecryptable field instead of aborting the batch", async () => {
    ;(auth as jest.Mock).mockResolvedValue(admin)
    const today = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const soon = new Date(today.getFullYear() - 30, today.getMonth(), today.getDate())
    // One corrupt row whose dateOfBirth ciphertext throws on decrypt — without
    // per-row handling this kills the whole batch, including the valid member.
    ;(decrypt as jest.Mock).mockImplementation((v: string) => {
      if (v === "enc:CORRUPT") throw new Error("bad ciphertext")
      return v.replace(/^enc:/, "")
    })
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue([
      { id: 1, firstName: "Corrupt", email: "enc:c@x.com", emailConsent: true, archivedAt: null, dateOfBirth: "enc:CORRUPT", family: { name: "F" } },
      { id: 2, firstName: "Valid", email: "enc:v@x.com", emailConsent: true, archivedAt: null, dateOfBirth: `enc:${iso(soon)}`, family: { name: "F" } },
    ])
    const res = await sendBirthdayEmailsBulk(7)
    // Corrupt row dropped before windowing; valid member still emailed.
    expect(res).toEqual({ sent: 1, skipped: 0, failed: 0 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it("logs a sanitized line (no member id, no raw exception) when a row fails to decrypt", async () => {
    ;(auth as jest.Mock).mockResolvedValue(admin)
    // Re-establish the module-level decrypt mock in case a previous test overrode it.
    ;(decrypt as jest.Mock).mockImplementation((v: string) => {
      if (v === "enc:__CORRUPT__") throw new Error("Unsupported state or unable to authenticate data")
      return v.replace(/^enc:/, "")
    })
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue([
      {
        id: 4242, firstName: "Cor", lastName: "Rupt",
        dateOfBirth: "enc:__CORRUPT__", email: "enc:c@x.com",
        emailConsent: true, family: { name: "Rupt" },
      },
    ])
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    await sendBirthdayEmailsBulk(7)
    expect(spy).toHaveBeenCalled()
    const logged = spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n")
    expect(logged).not.toContain("4242") // no Person.id
    expect(logged).not.toContain("authenticate data") // no raw exception body
    spy.mockRestore()
  })
})
