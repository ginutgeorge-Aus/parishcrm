/** @jest-environment node */
import { sendFundraiserReminderEmail } from "@/lib/email"
import type { FundraiserReminderData } from "@/lib/emails/FundraiserReminderEmail"

const sendMailMock = jest.fn(async () => ({ messageId: "id", accepted: ["a@example.com"], rejected: [] }))
jest.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: sendMailMock }) }))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findUnique: jest.fn(async () => null) } } }))

const data: FundraiserReminderData = {
  churchName: "Test Church", eventTitle: "Spring Fete", name: "Anna", quantity: 2,
  unitLabel: "Raffle book", unitPrice: "$10.00", owed: "$20.00", paid: "$5.00", remaining: "$15.00",
  payUrl: "https://app.test/pay/fundraiser/tok", cardFee: null, bankDetails: "BSB 000-000", bankRef: "REF1",
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GMAIL_USER = "test@gmail.com"
  process.env.GMAIL_APP_PASSWORD = "test-password"
})

it("sends a reminder with the event title only in the subject", async () => {
  await sendFundraiserReminderEmail("anna@example.com", data)
  expect(sendMailMock).toHaveBeenCalledTimes(1)
  const mail = (sendMailMock.mock.calls[0] as unknown as [Record<string, string>])[0]
  expect(mail.to).toBe("anna@example.com")
  expect(mail.subject).toBe("Payment reminder — Spring Fete")
  expect(mail.subject).not.toMatch(/\$|Anna/)
  expect(mail.from).toContain("Test Church")
  expect(mail.html).toContain("REF1")
  expect(mail.text).toContain("$15.00")
})
