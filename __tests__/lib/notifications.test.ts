/** @jest-environment node */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn(),
}))

import { notifyFailedLogin, notifyStripeAlert } from "@/lib/notifications"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"

const mockFindUnique = prisma.appSetting.findUnique as jest.Mock
const mockSendEmail = sendEmail as jest.Mock

describe("notifyFailedLogin", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSendEmail.mockResolvedValue(undefined)
  })

  it("does not call sendEmail when no ownerNotificationEmail setting exists", async () => {
    mockFindUnique.mockResolvedValue(null)
    await notifyFailedLogin("attacker@example.com")
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("does not call sendEmail when setting has empty value", async () => {
    mockFindUnique.mockResolvedValue({ key: "ownerNotificationEmail", value: "" })
    await notifyFailedLogin("attacker@example.com")
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("sends email to the configured owner address", async () => {
    mockFindUnique.mockResolvedValue({ key: "ownerNotificationEmail", value: "owner@church.com" })
    await notifyFailedLogin("attacker@example.com")
    expect(mockSendEmail).toHaveBeenCalledWith(
      "owner@church.com",
      expect.any(String),
      expect.any(String),
      expect.any(String)
    )
  })

  it("HTML-escapes the attempted email address in the body to prevent XSS", async () => {
    mockFindUnique.mockResolvedValue({ key: "ownerNotificationEmail", value: "owner@church.com" })
    await notifyFailedLogin('<script>alert(1)</script>@evil.com')
    const [, , htmlBody] = mockSendEmail.mock.calls[0]
    expect(htmlBody).toContain("&lt;script&gt;")
    expect(htmlBody).not.toContain("<script>")
  })

  it("propagates sendEmail errors — callers must .catch()", async () => {
    mockFindUnique.mockResolvedValue({ key: "ownerNotificationEmail", value: "owner@church.com" })
    mockSendEmail.mockRejectedValue(new Error("SMTP timeout"))
    await expect(notifyFailedLogin("test@example.com")).rejects.toThrow("SMTP timeout")
  })
})

describe("notifyStripeAlert", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSendEmail.mockResolvedValue(undefined)
  })

  it("does not call sendEmail when no ownerNotificationEmail setting exists", async () => {
    mockFindUnique.mockResolvedValue(null)
    await notifyStripeAlert("amount mismatch", "PI pi_123 charged 5000")
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("does not call sendEmail when setting has empty value", async () => {
    mockFindUnique.mockResolvedValue({ key: "ownerNotificationEmail", value: "" })
    await notifyStripeAlert("amount mismatch", "detail")
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("sends to the owner with the alert subject and detail in the body", async () => {
    mockFindUnique.mockResolvedValue({ key: "ownerNotificationEmail", value: "owner@church.com" })
    await notifyStripeAlert("amount mismatch", "PI pi_123 money retained")
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const [to, subject, html, text] = mockSendEmail.mock.calls[0]
    expect(to).toBe("owner@church.com")
    expect(subject).toContain("amount mismatch")
    expect(html).toContain("PI pi_123 money retained")
    expect(text).toContain("PI pi_123 money retained")
  })

  it("HTML-escapes the detail to prevent injection in the email body", async () => {
    mockFindUnique.mockResolvedValue({ key: "ownerNotificationEmail", value: "owner@church.com" })
    await notifyStripeAlert("subj", "<script>alert(1)</script>")
    const [, , html] = mockSendEmail.mock.calls[0]
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>")
  })

  it("SWALLOWS sendEmail errors so a webhook 200 is never turned into a throw", async () => {
    mockFindUnique.mockResolvedValue({ key: "ownerNotificationEmail", value: "owner@church.com" })
    mockSendEmail.mockRejectedValue(new Error("SMTP timeout"))
    await expect(notifyStripeAlert("subj", "detail")).resolves.toBeUndefined()
  })

  it("SWALLOWS a settings-lookup failure", async () => {
    mockFindUnique.mockRejectedValue(new Error("db down"))
    await expect(notifyStripeAlert("subj", "detail")).resolves.toBeUndefined()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
