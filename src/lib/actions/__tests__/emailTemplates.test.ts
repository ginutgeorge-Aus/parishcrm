/** @jest-environment node */

import { getEmailTemplate } from "@/lib/emailTemplateStore"
import {
  updateEmailTemplate,
  resetEmailTemplate,
  previewEmailTemplate,
  sendTestEmail,
} from "@/lib/actions/emailTemplates"
import { featureGuard } from "@/lib/featureFlags"
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { sendEmail } from "@/lib/email"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags")
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    emailTemplate: { findUnique: jest.fn(), upsert: jest.fn() },
    user: { findUnique: jest.fn(async () => ({ email: "admin@example.com" })) },
  },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn(async () => ({ name: "Test Church", address: "", abn: "", email: "", website: "" })),
}))
jest.mock("@/lib/receiptSettings", () => ({
  getReceiptSettings: jest.fn(async () => ({
    numberPrefix: "DGR",
    documentTitle: "CUSTOM RECEIPT HEADING",
    totalLabel: "CUSTOM DONATION TOTAL",
    coveredPeriodTemplate: "Gifts from {from} to {to}",
    legalText: "Legal text",
  })),
}))

const mockAuth = auth as jest.Mock
const mockFind = prisma.emailTemplate.findUnique as jest.Mock
const mockUpsert = prisma.emailTemplate.upsert as jest.Mock

describe("getEmailTemplate", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  })

  it("returns code default when row missing", async () => {
    mockFind.mockResolvedValue(null)
    expect(await getEmailTemplate("welcome")).toEqual(DEFAULT_EMAIL_TEMPLATES.welcome)
  })
  it("falls back per-field when a stored field is blank", async () => {
    mockFind.mockResolvedValue({ key: "welcome", subject: "Custom", intro: "", body: "", signoff: "" })
    const t = await getEmailTemplate("welcome")
    expect(t.subject).toBe("Custom")
    expect(t.intro).toBe(DEFAULT_EMAIL_TEMPLATES.welcome.intro)
  })
  it("returns default on DB error", async () => {
    mockFind.mockRejectedValue(new Error("db down"))
    expect(await getEmailTemplate("receipt")).toEqual(DEFAULT_EMAIL_TEMPLATES.receipt)
  })
})

describe("updateEmailTemplate", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  })

  it("rejects non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "2", role: "VIEWER" } })
    const fd = new FormData()
    fd.set("key", "welcome"); fd.set("subject", "x"); fd.set("intro", ""); fd.set("body", ""); fd.set("signoff", "")
    expect(await updateEmailTemplate(undefined, fd)).toEqual({ error: "Unauthorized" })
  })
  it("rejects bad key", async () => {
    const fd = new FormData()
    fd.set("key", "bogus"); fd.set("subject", "x"); fd.set("intro", ""); fd.set("body", ""); fd.set("signoff", "")
    expect(await updateEmailTemplate(undefined, fd)).toEqual({ error: "Invalid template" })
  })
  it("rejects empty subject", async () => {
    const fd = new FormData()
    fd.set("key", "welcome"); fd.set("subject", ""); fd.set("intro", ""); fd.set("body", ""); fd.set("signoff", "")
    const res = await updateEmailTemplate(undefined, fd)
    expect(res && "error" in res).toBe(true)
  })
  it("upserts on valid admin update", async () => {
    const fd = new FormData()
    fd.set("key", "welcome"); fd.set("subject", "Hi"); fd.set("intro", "i"); fd.set("body", "b"); fd.set("signoff", "s")
    expect(await updateEmailTemplate(undefined, fd)).toEqual({ success: "Template saved" })
    expect(mockUpsert).toHaveBeenCalled()
  })
})

describe("resetEmailTemplate", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  })

  it("rejects non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "2", role: "VIEWER" } })
    expect(await resetEmailTemplate("welcome")).toEqual({ error: "Unauthorized" })
  })
  it("upserts defaults for admin", async () => {
    expect(await resetEmailTemplate("receipt")).toEqual({ success: "Template reset to default" })
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "receipt" } }),
    )
  })
})

describe("previewEmailTemplate", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  })

  it("renders the configured DGR receipt captions", async () => {
    const result = await previewEmailTemplate("dgrReceipt", DEFAULT_EMAIL_TEMPLATES.dgrReceipt)

    expect(result).toEqual({ html: expect.stringContaining("CUSTOM RECEIPT HEADING") })
    expect("html" in result && result.html).toContain("CUSTOM DONATION TOTAL")
  })
})

describe("feature-owned templates are blocked while their feature is off", () => {
  const OFF = { error: "This feature is turned off." }
  const fields = { subject: "s", intro: "i", body: "b", signoff: "x" }
  const form = (key: string) => {
    const f = new FormData()
    for (const [k, v] of Object.entries({ key, ...fields })) f.set(k, v)
    return f
  }
  const calls = {
    updateEmailTemplate: (key: string) => updateEmailTemplate(undefined, form(key)),
    resetEmailTemplate: (key: string) => resetEmailTemplate(key as never),
    previewEmailTemplate: (key: string) => previewEmailTemplate(key as never, fields),
    sendTestEmail: (key: string) => sendTestEmail(key as never, fields),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    delete process.env.DEMO_MODE
  })

  it.each(Object.entries(calls).flatMap(([name, call]) =>
    ([["familyUpdate", "familyUpdates"], ["receipt", "receipts"], ["dgrReceipt", "dgrReceipts"]] as const)
      .map(([key, feature]) => [name, key, feature, call] as const)))(
    "%s(%s) returns the off message while %s is off, after auth and before DB",
    async (_name, key, feature, call) => {
      ;(featureGuard as jest.Mock).mockResolvedValueOnce(OFF)
      expect(await call(key)).toEqual(OFF)
      expect(featureGuard).toHaveBeenCalledWith(feature)
      expect(mockAuth).toHaveBeenCalled()
      expect(mockUpsert).not.toHaveBeenCalled()
    })

  it.each(Object.keys(calls))("%s rejects a non-admin before checking the feature", async (name) => {
    mockAuth.mockResolvedValue({ user: { id: "2", role: "VIEWER" } })
    expect(await calls[name as keyof typeof calls]("receipt")).toEqual({ error: "Unauthorized" })
    expect(featureGuard).not.toHaveBeenCalled()
  })

  it("the core welcome template never checks a feature", async () => {
    mockUpsert.mockResolvedValue({})
    expect(await resetEmailTemplate("welcome")).toEqual({ success: "Template reset to default" })
    expect(featureGuard).not.toHaveBeenCalled()
  })

  it("demo mode is checked before the feature", async () => {
    process.env.DEMO_MODE = "true"
    const res = await resetEmailTemplate("receipt")
    expect(res).toMatchObject({ error: expect.any(String) })
    expect(featureGuard).not.toHaveBeenCalled()
    delete process.env.DEMO_MODE
  })
})

describe("sendTestEmail", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.DEMO_MODE
  })

  // Real sessions carry no email: the jwt callback strips it (#369).
  it("sends to the DB email of the session's user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    const res = await sendTestEmail("welcome", { subject: "s", intro: "i", body: "b", signoff: "x" })
    expect(res).toEqual({ success: "Test email sent to admin@example.com" })
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 1 }, select: { email: true } })
    expect((sendEmail as jest.Mock).mock.calls[0][0]).toBe("admin@example.com")
  })
})
