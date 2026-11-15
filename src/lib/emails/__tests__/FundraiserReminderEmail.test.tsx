/** @jest-environment node */
import { render } from "@react-email/render"
import { FundraiserReminderEmail, type FundraiserReminderData } from "@/lib/emails/FundraiserReminderEmail"

const base: FundraiserReminderData = {
  churchName: "Example Church",
  eventTitle: "Spring Raffle",
  name: "Anna",
  quantity: 3,
  unitLabel: "Raffle book",
  unitPrice: "$10.00",
  owed: "$30.00",
  paid: "$10.00",
  remaining: "$20.00",
  payUrl: "https://app.example.org/pay/fundraiser/tok-1",
  cardFee: "$0.66",
  bankDetails: "BSB 000-000\nAcc 12345678",
  bankRef: "RAF-ABC123",
}

test("renders amounts, bank details, bank ref, pay link and card fee", async () => {
  const text = await render(<FundraiserReminderEmail {...base} />, { plainText: true })
  for (const s of ["Anna", "$30.00", "$10.00", "$20.00", "BSB 000-000", "Acc 12345678", "RAF-ABC123", "$0.66"]) {
    expect(text).toContain(s)
  }
  const html = await render(<FundraiserReminderEmail {...base} />)
  expect(html).toContain("https://app.example.org/pay/fundraiser/tok-1")
})

test("omits pay link and card fee when null", async () => {
  const html = await render(<FundraiserReminderEmail {...base} payUrl={null} cardFee={null} />)
  expect(html).not.toContain("/pay/fundraiser/")
  expect(html).not.toContain("Pay online")
  expect(html).toContain("RAF-ABC123")
})

test.each([null, "", "  \n "])("omits the bank-transfer section and reference when bank details are %p", async (bankDetails) => {
  const text = await render(<FundraiserReminderEmail {...base} bankDetails={bankDetails} />, { plainText: true })
  expect(text).not.toContain("bank transfer")
  expect(text).not.toContain("RAF-ABC123")
  expect(text).toContain("Pay online")
})
