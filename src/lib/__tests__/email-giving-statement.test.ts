/** @jest-environment node */
import { sendGivingStatementEmail } from "@/lib/email"

const sendMailMock = jest.fn<Promise<{ messageId: string }>, [Record<string, unknown>]>(async () => ({
  messageId: "test-id",
}))

jest.mock("nodemailer", () => ({
  createTransport: () => ({
    sendMail: sendMailMock,
  }),
}))

jest.mock("@/lib/emailTemplateStore", () => ({
  getEmailTemplate: jest.fn(),
  getChurchName: jest.fn(async () => "Test Church"),
}))

const data = {
  churchName: "Example Church",
  churchAbn: "12 345 678 901",
  churchAddress: "1 Church St, Springfield NSW",
  churchEmail: "church@example.com",
  familyName: "Example",
  fyLabel: "2024–25",
  periodLabel: "1 July 2024 – 30 June 2025",
  totalLabel: "$1,250.00",
}

describe("sendGivingStatementEmail", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GMAIL_USER = "test@gmail.com"
    process.env.GMAIL_APP_PASSWORD = "test-password"
  })

  it("renders and sends the statement with the PDF attached", async () => {
    const pdf = Buffer.from("fake pdf")
    const outcome = await sendGivingStatementEmail("donor@example.com", pdf, data)

    expect(outcome).toBe("sent")
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const call = sendMailMock.mock.calls[0][0]
    expect(call.to).toBe("donor@example.com")
    expect(String(call.subject)).toBe("Your giving statement — FY 2024–25")
    expect(String(call.html)).toContain("$1,250.00")
    expect(String(call.text)).toContain("$1,250.00")
    const attachments = call.attachments as Array<{ filename: string; content: Buffer }>
    expect(attachments[0].filename).toBe("giving-statement-2024–25.pdf")
    expect(attachments[0].content).toBe(pdf)
  })

  it("sends when the deadline check passes", async () => {
    const isExpired = jest.fn(() => false)
    const outcome = await sendGivingStatementEmail("donor@example.com", Buffer.from("x"), data, isExpired)

    expect(outcome).toBe("sent")
    expect(isExpired).toHaveBeenCalledTimes(1)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
  })

  it("returns expired without sending when the deadline passed during render", async () => {
    const outcome = await sendGivingStatementEmail("donor@example.com", Buffer.from("x"), data, () => true)

    expect(outcome).toBe("expired")
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})
