/** @jest-environment node */
jest.mock("nodemailer", () => ({
  createTransport: jest.fn(),
}))

import * as nodemailer from "nodemailer"
import { sendPasswordResetEmail, sendFamilyUpdateInviteEmail } from "@/lib/email"

const mockSendMail = jest.fn()
const mockCreateTransport = nodemailer.createTransport as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockSendMail.mockResolvedValue({})
  mockCreateTransport.mockReturnValue({ sendMail: mockSendMail })
  process.env.GMAIL_USER = "church@gmail.com"
  process.env.GMAIL_APP_PASSWORD = "app-pass"
})

describe("sendPasswordResetEmail", () => {
  it("sends email with reset link in html and text", async () => {
    await sendPasswordResetEmail("user@example.com", "https://app/reset-password?token=abc123")
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        subject: expect.stringContaining("Password Reset"),
        html: expect.stringContaining("https://app/reset-password?token=abc123"),
        text: expect.stringContaining("https://app/reset-password?token=abc123"),
      })
    )
  })

  it("includes 1 hour expiry in html and text", async () => {
    await sendPasswordResetEmail("user@example.com", "https://app/reset-password?token=abc123")
    const call = mockSendMail.mock.calls[0][0]
    expect(call.html).toContain("1 hour")
    expect(call.text).toContain("1 hour")
  })
})

describe("sendFamilyUpdateInviteEmail", () => {
  it("sends email with update link and 14 days expiry", async () => {
    await sendFamilyUpdateInviteEmail(
      "family@example.com",
      "https://app/family-update?token=xyz789",
      "Smith Family"
    )
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "family@example.com",
        subject: expect.stringContaining("Update your family details"),
        html: expect.stringContaining("https://app/family-update?token=xyz789"),
        text: expect.stringContaining("https://app/family-update?token=xyz789"),
      })
    )
    const call = mockSendMail.mock.calls[0][0]
    expect(call.html).toContain("14 days")
    expect(call.text).toContain("14 days")
  })
})
