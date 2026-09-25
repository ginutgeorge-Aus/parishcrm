/** @jest-environment node */
import { updateBirthdayTemplate, getBirthdayTemplate, sendTestBirthdayEmail, sendTestAnniversaryEmail } from "@/lib/actions/settings"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { upsert: jest.fn(), findMany: jest.fn() },
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }))
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { logAudit } from "@/lib/audit"

const fd = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.append(k, v)
  return f
}

describe("updateBirthdayTemplate", () => {
  beforeEach(() => jest.clearAllMocks())

  it("rejects non-admin", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "PASTOR", id: "2" } })
    const res = await updateBirthdayTemplate(undefined, fd({ birthdayEmailSubject: "s", birthdayEmailBody: "b" }))
    expect(res).toEqual({ error: "Unauthorized" })
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })

  it("upserts both keys for admin", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    ;(prisma.appSetting.upsert as jest.Mock).mockResolvedValue({})
    const res = await updateBirthdayTemplate(undefined, fd({ birthdayEmailSubject: "Hi {firstName}", birthdayEmailBody: "Body" }))
    expect(res).toEqual({ success: "Birthday email template saved" })
    expect(prisma.appSetting.upsert).toHaveBeenCalledTimes(2)
  })
})

describe("getBirthdayTemplate", () => {
  beforeEach(() => jest.clearAllMocks())

  it("falls back to defaults when no rows", async () => {
    ;(prisma.appSetting.findMany as jest.Mock).mockResolvedValue([])
    const tpl = await getBirthdayTemplate()
    expect(tpl.subject).toContain("{firstName}")
  })

  it("uses stored values when present", async () => {
    ;(prisma.appSetting.findMany as jest.Mock).mockResolvedValue([
      { key: "birthdayEmailSubject", value: "Custom {firstName}" },
      { key: "birthdayEmailBody", value: "Custom body" },
    ])
    const tpl = await getBirthdayTemplate()
    expect(tpl).toEqual({ subject: "Custom {firstName}", body: "Custom body" })
  })
})

describe("sendTestBirthdayEmail / sendTestAnniversaryEmail", () => {
  beforeEach(() => jest.clearAllMocks())

  it("rejects non-admin without sending", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "PASTOR", id: "2", email: "p@x.org" } })
    const res = await sendTestBirthdayEmail({ subject: "Hi {firstName}", body: "Bless {them}" })
    expect(res).toEqual({ error: "Unauthorized" })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("errors when the admin account has no email", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1", email: null } })
    const res = await sendTestBirthdayEmail({ subject: "Hi {firstName}", body: "Bless {them}" })
    expect(res).toEqual({ error: "Your account has no email address" })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("sends a rendered birthday sample to the admin and audits", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1", email: "admin@x.org" } })
    const res = await sendTestBirthdayEmail({ subject: "Happy Birthday {firstName}", body: "Bless {them}, {firstName}" })
    expect(res).toEqual({ success: "Test birthday email sent to admin@x.org" })
    const [to, subject, html, text] = (sendEmail as jest.Mock).mock.calls[0]
    expect(to).toBe("admin@x.org")
    expect(subject).toBe("[TEST] Happy Birthday Sample Member")
    expect(text).toBe("Bless them, Sample Member") // pronouns(null) → they/them/their
    expect(html).toContain("Bless them, Sample Member")
    expect(logAudit).toHaveBeenCalledWith(1, "BIRTHDAY_EMAIL_TEST_SENT", "AppSetting", undefined)
  })

  it("sends a rendered anniversary sample to the admin and audits", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1", email: "admin@x.org" } })
    const res = await sendTestAnniversaryEmail({ subject: "Anniversary {names}", body: "{years} years for {names}" })
    expect(res).toEqual({ success: "Test anniversary email sent to admin@x.org" })
    const [, subject, , text] = (sendEmail as jest.Mock).mock.calls[0]
    expect(subject).toBe("[TEST] Anniversary Alex & Sam Sample")
    expect(text).toBe("25 years for Alex & Sam Sample")
    expect(logAudit).toHaveBeenCalledWith(1, "ANNIVERSARY_EMAIL_TEST_SENT", "AppSetting", undefined)
  })

  it("returns a clean error when delivery throws", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1", email: "admin@x.org" } })
    ;(sendEmail as jest.Mock).mockRejectedValueOnce(new Error("smtp down"))
    const res = await sendTestBirthdayEmail({ subject: "Hi {firstName}", body: "Bless {them}" })
    expect(res).toEqual({ error: "Failed to send test email — check email configuration" })
  })
})
