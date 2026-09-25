/** @jest-environment node */

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(),
}))
jest.mock("@react-email/render", () => ({
  render: jest.fn(() => Promise.resolve("<html>receipt</html>")),
}))
jest.mock("@/lib/emails/ReceiptEmail", () => ({
  ReceiptEmail: jest.fn(() => null),
}))

import { sendEmail, sendReceiptEmail } from "@/lib/email"
import * as nodemailer from "nodemailer"
import type { ReceiptData } from "@/lib/emails/ReceiptEmail"

const mockSendMail = jest.fn()
const mockCreateTransport = nodemailer.createTransport as jest.Mock

const validReceipt: ReceiptData = {
  transactionId: 42,
  description: "Sunday Offering",
  date: "22 May 2026",
  amount: "$100.00",
  type: "INCOME",
  account: "Sunday Offering",
  churchName: "Example Church",
  churchAddress: "123 Example St, Sydney NSW 2000",
  churchAbn: "12 345 678 901",
  churchEmail: "church@example.com",
}

describe("email", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSendMail.mockResolvedValue({})
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail })
    process.env.GMAIL_USER = "test@gmail.com"
    process.env.GMAIL_APP_PASSWORD = "testpass"
  })

  describe("sendEmail", () => {
    it("passes to/subject/html/text to sendMail", async () => {
      await sendEmail("recipient@example.com", "Test Subject", "<p>Hello</p>", "Hello")
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "recipient@example.com",
          subject: "Test Subject",
          html: "<p>Hello</p>",
          text: "Hello",
        })
      )
    })

    it("throws when GMAIL_USER is missing", async () => {
      const saved = process.env.GMAIL_USER
      delete process.env.GMAIL_USER
      await expect(sendEmail("a@b.com", "sub", "<p/>", "t")).rejects.toThrow("Email not configured")
      process.env.GMAIL_USER = saved
    })

    it("throws when GMAIL_APP_PASSWORD is missing", async () => {
      const saved = process.env.GMAIL_APP_PASSWORD
      delete process.env.GMAIL_APP_PASSWORD
      await expect(sendEmail("a@b.com", "sub", "<p/>", "t")).rejects.toThrow("Email not configured")
      process.env.GMAIL_APP_PASSWORD = saved
    })
  })

  describe("sendReceiptEmail", () => {
    it("constructs subject containing transaction ID", async () => {
      await sendReceiptEmail("recipient@example.com", validReceipt)
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining("42"),
        })
      )
    })

    it("does not leak the transaction description in the subject", async () => {
      await sendReceiptEmail("recipient@example.com", validReceipt)
      const { subject } = mockSendMail.mock.calls[0][0]
      expect(subject).not.toContain("Sunday Offering")
      expect(subject).toBe("Donation Receipt #42 — 22 May 2026")
    })

    it("uses churchName as the from display name", async () => {
      await sendReceiptEmail("recipient@example.com", validReceipt)
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.stringContaining("Example Church"),
        })
      )
    })
  })

  describe("transporter singleton", () => {
    it("creates the transporter at most once across many sends", async () => {
      // Fresh module so the singleton starts unset for this assertion.
      jest.resetModules()
      const freshCreate = jest.fn().mockReturnValue({ sendMail: mockSendMail })
      jest.doMock("nodemailer", () => ({ createTransport: freshCreate }))
      jest.doMock("@react-email/render", () => ({
        render: jest.fn(() => Promise.resolve("<html>receipt</html>")),
      }))
      jest.doMock("@/lib/emails/ReceiptEmail", () => ({
        ReceiptEmail: jest.fn(() => null),
      }))
      const { sendEmail: send, sendReceiptEmail: sendReceipt } = await import("@/lib/email")

      await send("a@b.com", "s", "<p/>", "t")
      await send("c@d.com", "s2", "<p/>", "t2")
      await sendReceipt("e@f.com", validReceipt)

      expect(freshCreate).toHaveBeenCalledTimes(1)
      expect(mockSendMail).toHaveBeenCalledTimes(3)
    })
  })
})
