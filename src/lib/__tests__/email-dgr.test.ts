/** @jest-environment node */
import { sendDgrReceiptEmail } from "@/lib/email"

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

// Force the code-default template (no DB) so subject/body come from
// DEFAULT_EMAIL_TEMPLATES.dgrReceipt — the admin-editable copy path.
jest.mock("@/lib/emailTemplateStore", () => {
  const { DEFAULT_EMAIL_TEMPLATES } = jest.requireActual("@/lib/emailTemplates")
  return {
    getEmailTemplate: jest.fn(async (k: string) => DEFAULT_EMAIL_TEMPLATES[k]),
    getChurchName: jest.fn(async () => process.env.CHURCH_NAME ?? "Test Church"),
  }
})

describe("sendDgrReceiptEmail", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GMAIL_USER = "test@gmail.com"
    process.env.GMAIL_APP_PASSWORD = "test-password"
    process.env.CHURCH_NAME = "Test Church"
  })

  it("sends a DGR receipt email with PDF attachment and templated content", async () => {
    const pdfBuffer = Buffer.from("fake pdf content")
    const meta = {
      receiptNo: "DGR-2025-001",
      fyLabel: "2024–25",
      churchName: "Example Church Springfield",
      donorName: "Jane Member",
      churchAbn: "12 345 678 901",
      churchAddress: "1 Church St, Springfield NSW",
      churchEmail: "church@example.com",
      issueDate: "01-07-2025",
      documentTitle: "CUSTOM RECEIPT HEADING",
      totalLabel: "$1,250.00",
      totalDonationsLabel: "CUSTOM DONATION TOTAL",
      coveredPeriod: "This receipt covers tax-deductible gifts received between 1 July 2024 and 30 June 2025.",
    }

    await sendDgrReceiptEmail("donor@example.com", pdfBuffer, meta)

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const call = sendMailMock.mock.calls[0][0] as unknown as Record<string, unknown>

    expect(call.to).toBe("donor@example.com")
    // Subject comes from the editable template with {vars} substituted.
    expect(String(call.subject)).toBe("Annual Donation Receipt DGR-2025-001 — FY 2024–25")
    // Body renders the donor's name and receipt number from the template.
    expect(String(call.html)).toContain("Jane Member")
    expect(String(call.html)).toContain("DGR-2025-001")
    expect(String(call.html)).toContain("CUSTOM RECEIPT HEADING")
    expect(String(call.html)).toContain("CUSTOM DONATION TOTAL")
    // Professional receipt layout renders the hero total + official footer.
    expect(String(call.html)).toContain("$1,250.00")
    expect(String(call.html)).toContain("12 345 678 901")
    const attachments = call.attachments as Array<{ filename: string; content: Buffer; contentType: string }>
    expect(attachments).toHaveLength(1)
    expect(attachments[0].filename).toBe("DGR-2025-001.pdf")
    expect(attachments[0].content).toBe(pdfBuffer)
    expect(attachments[0].contentType).toBe("application/pdf")
  })
})
