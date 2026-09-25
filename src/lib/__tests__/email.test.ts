/** @jest-environment node */
import * as React from "react"
import { render } from "@react-email/render"
import { sendWelcomeEmail, sendPasswordResetEmail, sendRegistrationConfirmationEmail, sendMembershipNotificationEmail, isTransientSmtpError, isAmbiguousDeliveryError } from "@/lib/email"
import { WelcomeEmail } from "@/lib/emails/WelcomeEmail"
import { ReceiptEmail, type ReceiptData } from "@/lib/emails/ReceiptEmail"

// Mock nodemailer.createTransport to capture sendMail calls
const sendMailMock = jest.fn<
  Promise<{ messageId: string; accepted: string[]; rejected: string[] }>,
  [Record<string, unknown>]
>(async () => ({
  messageId: "test-id",
  accepted: ["test@example.com"],
  rejected: [],
}))

jest.mock("nodemailer", () => ({
  createTransport: () => ({
    sendMail: sendMailMock,
  }),
}))

const appSettingFindUnique = jest.fn<Promise<{ value: string } | null>, [unknown]>(async () => null)
jest.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findUnique: (...a: unknown[]) => appSettingFindUnique(a) } },
}))

describe("email", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    appSettingFindUnique.mockResolvedValue(null)
    process.env.GMAIL_USER = "test@gmail.com"
    process.env.GMAIL_APP_PASSWORD = "test-password"
    process.env.CHURCH_NAME = "Test Church"
    delete process.env.MEMBERSHIP_SECRETARY_EMAIL
  })

  describe("sendMembershipNotificationEmail destination precedence", () => {
    it("uses the membershipSecretaryEmail AppSetting when set", async () => {
      appSettingFindUnique.mockResolvedValue({ value: "  db@example.com  " })
      process.env.MEMBERSHIP_SECRETARY_EMAIL = "env@example.com"
      await sendMembershipNotificationEmail("Jane Doe")
      expect(sendMailMock).toHaveBeenCalledTimes(1)
      expect(sendMailMock.mock.calls[0][0].to).toBe("db@example.com")
    })

    it("falls back to the env var when the AppSetting is blank", async () => {
      appSettingFindUnique.mockResolvedValue({ value: "   " })
      process.env.MEMBERSHIP_SECRETARY_EMAIL = "env@example.com"
      await sendMembershipNotificationEmail("Jane Doe")
      expect(sendMailMock.mock.calls[0][0].to).toBe("env@example.com")
    })

    it("falls back to GMAIL_USER when neither is set", async () => {
      await sendMembershipNotificationEmail("Jane Doe")
      expect(sendMailMock.mock.calls[0][0].to).toBe("test@gmail.com")
    })

    it("does not leak the applicant name into the email subject", async () => {
      await sendMembershipNotificationEmail("Jane Doe")
      expect(String(sendMailMock.mock.calls[0][0].subject)).not.toContain("Jane Doe")
    })

    it("attaches the application PDF when a buffer is provided", async () => {
      await sendMembershipNotificationEmail("Jane Doe", Buffer.from("%PDF-fake"))
      const call = sendMailMock.mock.calls[0][0] as unknown as Record<string, unknown>
      const attachments = call.attachments as { filename: string; content: Buffer; contentType: string }[]
      expect(attachments).toHaveLength(1)
      expect(attachments[0].filename).toBe("membership-Jane_Doe.pdf")
      expect(attachments[0].contentType).toBe("application/pdf")
      expect(Buffer.isBuffer(attachments[0].content)).toBe(true)
    })

    it("omits attachments when no PDF is provided", async () => {
      await sendMembershipNotificationEmail("Jane Doe")
      const call = sendMailMock.mock.calls[0][0] as unknown as Record<string, unknown>
      expect(call.attachments).toBeUndefined()
    })
  })

  // an SMTP socket error AFTER the message body is submitted (Gmail may
  // have accepted it but the ack was lost) must NOT be auto-retried, or a second
  // copy of a receipt/reset/invite goes out. Only pre-submission failures — where
  // the message provably never left — are safe to retry.
  describe("SMTP error phase classification", () => {
    it("retries pre-submission failures (connection/DNS/TLS never sent the message)", () => {
      for (const code of ["ECONNREFUSED", "EDNS", "EAI_AGAIN", "ECONNECTION", "ETLS"]) {
        expect(isTransientSmtpError({ code })).toBe(true)
      }
      // 4xx SMTP reply = server rejected before accepting → not delivered → retry.
      expect(isTransientSmtpError({ responseCode: 421 })).toBe(true)
      expect(isTransientSmtpError({ responseCode: 451 })).toBe(true)
    })

    it("does NOT retry post-submission-ambiguous socket errors (may already be delivered)", () => {
      for (const code of ["ETIMEDOUT", "ECONNRESET", "ESOCKET", "EPIPE"]) {
        expect(isTransientSmtpError({ code })).toBe(false)
        expect(isAmbiguousDeliveryError({ code })).toBe(true)
      }
    })

    it("does not retry permanent auth failures", () => {
      expect(isTransientSmtpError({ responseCode: 535 })).toBe(false)
      expect(isAmbiguousDeliveryError({ responseCode: 535 })).toBe(false)
    })

    it("treats pre-submission failures as unambiguous (they never reached the server)", () => {
      expect(isAmbiguousDeliveryError({ code: "ECONNREFUSED" })).toBe(false)
    })
  })

  describe("ambiguous-delivery handling", () => {
    it("sends once (no retry), alerts the owner, and rethrows on an ambiguous socket error", async () => {
      appSettingFindUnique.mockResolvedValue({ value: "owner@example.com" })
      // ETIMEDOUT could be a lost post-DATA ack — message may have been delivered.
      sendMailMock.mockRejectedValueOnce({ code: "ETIMEDOUT" })
      await expect(sendPasswordResetEmail("user@example.com", "https://reset/x")).rejects.toBeDefined()
      // 1 send attempt (NOT retried) + 1 owner-alert send = 2 total.
      expect(sendMailMock).toHaveBeenCalledTimes(2)
      expect(sendMailMock.mock.calls[1][0].to).toBe("owner@example.com")
      // Owner alert must say delivery is unknown, not "failed" (it may have gone out).
      expect(String(sendMailMock.mock.calls[1][0].subject).toLowerCase()).toContain("unknown")
    })
  })

  describe("sendWelcomeEmail", () => {
    it("sends a welcome email with subject and both urls", async () => {
      await sendWelcomeEmail("u@x.com", {
        name: "Jane",
        role: "Office Admin",
        setPasswordUrl: "https://a/reset-password?token=t",
        helpUrl: "https://a/help",
      })

      expect(sendMailMock).toHaveBeenCalledTimes(1)
      const arg = sendMailMock.mock.calls[0][0] as unknown as Record<string, unknown>

      expect(arg.to).toBe("u@x.com")
      expect(String(arg.subject)).toContain("set your password")
      expect(String(arg.html)).toContain("https://a/reset-password?token=t")
      expect(String(arg.text)).toContain("https://a/help")
    })
  })

  describe("template components render slots", () => {
    it("renders welcome slots and keeps the button link", async () => {
      const html = await render(
        React.createElement(WelcomeEmail, {
          setPasswordUrl: "https://x/set",
          helpUrl: "https://x/help",
          churchName: "Example Church",
          intro: "Hello Jane,",
          body: "Body text here.",
          signoff: "Signoff line.",
        }),
      )
      expect(html).toContain("Hello Jane,")
      expect(html).toContain("Body text here.")
      expect(html).toContain("https://x/set")
    })

    it("renders the receipt signoff and keeps the amount/ABN", async () => {
      const data: ReceiptData = {
        transactionId: 7, date: "01/07/2025", description: "Offering", amount: "$50.00",
        type: "INCOME", account: "General", churchName: "Example Church",
        churchAddress: "1 St", churchAbn: "11 222 333 444", churchEmail: "c@x.com",
      }
      const html = await render(React.createElement(ReceiptEmail, { data, intro: "Thank you!", signoff: "Keep this receipt." }))
      expect(html).toContain("Thank you!")
      expect(html).toContain("Keep this receipt.")
      expect(html).toContain("$50.00")
      expect(html).toContain("11 222 333 444")
    })
  })

  describe("sendPasswordResetEmail", () => {
    it("sends a password reset email", async () => {
      await sendPasswordResetEmail("user@example.com", "https://reset.url/token=abc")

      expect(sendMailMock).toHaveBeenCalledTimes(1)
      const arg = sendMailMock.mock.calls[0][0] as unknown as Record<string, unknown>

      expect(arg.to).toBe("user@example.com")
      expect(String(arg.subject)).toContain("Password Reset")
      expect(String(arg.html)).toContain("https://reset.url/token=abc")
    })
  })

  describe("sendRegistrationConfirmationEmail", () => {
    it("sends with subject, html, and attaches the ics when provided", async () => {
      await sendRegistrationConfirmationEmail("reg@example.com", {
        churchName: "Test Church",
        eventTitle: "Parish Picnic",
        eventDateLabel: "Tue 15 Jul 2026",
        registrantName: "Jane Doe",
        items: [{ quantity: 1, ticketName: "Adult", attendeeNames: ["Jane Doe"] }],
        totalLabel: "$20.00",
        payment: { bankBsb: "012-345", bankAccount: "12345678", reference: "REG-X" },
        ics: { content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", filename: "event.ics" },
      })
      expect(sendMailMock).toHaveBeenCalledTimes(1)
      const call = sendMailMock.mock.calls[0][0] as unknown as Record<string, unknown>
      expect(call.to).toBe("reg@example.com")
      expect(String(call.subject)).toContain("Parish Picnic")
      expect(String(call.html)).toContain("Jane Doe")
      const attachments = call.attachments as { filename: string; contentType: string }[]
      expect(attachments[0].filename).toBe("event.ics")
      expect(attachments[0].contentType).toBe("text/calendar")
    })

    it("omits attachments when no ics provided", async () => {
      await sendRegistrationConfirmationEmail("reg@example.com", {
        churchName: "Test Church",
        eventTitle: "Talk",
        registrantName: "Jane",
        items: [{ quantity: 1, ticketName: "Free", attendeeNames: ["Jane"] }],
        totalLabel: "$0.00",
      })
      const call = sendMailMock.mock.calls[0][0] as unknown as Record<string, unknown>
      expect(call.attachments).toBeUndefined()
    })

    // the non-sendEmail senders (registration/reminder/receipt/dgr) used to
    // call transporter.sendMail directly, bypassing withRetry + owner alerting.
    // A permanent failure must now alert the owner and rethrow, same as sendEmail.
    it("alerts the owner and rethrows when the send permanently fails", async () => {
      appSettingFindUnique.mockResolvedValue({ value: "owner@example.com" })
      // 535 = auth failure → non-transient (no retry), immediate alert path.
      sendMailMock.mockRejectedValueOnce({ responseCode: 535 })
      await expect(
        sendRegistrationConfirmationEmail("reg@example.com", {
          churchName: "Test Church",
          eventTitle: "Talk",
          registrantName: "Jane",
          items: [{ quantity: 1, ticketName: "Free", attendeeNames: ["Jane"] }],
          totalLabel: "$0.00",
        }),
      ).rejects.toBeDefined()
      // Owner was looked up + a second (alert) send was issued.
      expect(appSettingFindUnique).toHaveBeenCalled()
      expect(sendMailMock).toHaveBeenCalledTimes(2)
      expect(sendMailMock.mock.calls[1][0].to).toBe("owner@example.com")
    })
  })
})
