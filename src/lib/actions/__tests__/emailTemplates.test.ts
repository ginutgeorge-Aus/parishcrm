/** @jest-environment node */

import { getEmailTemplate } from "@/lib/emailTemplateStore"
import {
  updateEmailTemplate,
  resetEmailTemplate,
  previewEmailTemplate,
} from "@/lib/actions/emailTemplates"
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { emailTemplate: { findUnique: jest.fn(), upsert: jest.fn() } },
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
