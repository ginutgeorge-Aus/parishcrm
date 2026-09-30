/** @jest-environment node */
import { isResendConfigured, senderAddress } from "@/lib/mailConfig"

describe("mailConfig", () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.RESEND_API_KEY
    delete process.env.MAIL_FROM
    process.env.GMAIL_USER = "church@gmail.com"
  })
  afterAll(() => {
    process.env = saved
  })

  it("uses Gmail when no Resend key is set", () => {
    expect(isResendConfigured()).toBe(false)
    expect(senderAddress()).toBe("church@gmail.com")
  })

  it("uses MAIL_FROM when Resend is configured", () => {
    process.env.RESEND_API_KEY = "re_key"
    process.env.MAIL_FROM = "noreply@church.test"
    expect(isResendConfigured()).toBe(true)
    expect(senderAddress()).toBe("noreply@church.test")
  })

  it("returns empty string when nothing is configured", () => {
    delete process.env.GMAIL_USER
    expect(senderAddress()).toBe("")
  })
})
