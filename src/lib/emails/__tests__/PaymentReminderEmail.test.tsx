/** @jest-environment node */
import { render } from "@react-email/render"
import { PaymentReminderEmail } from "@/lib/emails/PaymentReminderEmail"

test("renders operator message, amount due, and event link", async () => {
  const html = await render(
    <PaymentReminderEmail
      churchName="Example Church"
      eventTitle="Parish Retreat"
      recipientName="Anna"
      amountDue="$25.00"
      message="Please complete your payment before Sunday."
      eventUrl="https://app.example.org/e/parish-retreat"
    />
  )
  expect(html).toContain("Please complete your payment before Sunday.")
  expect(html).toContain("$25.00")
  expect(html).toContain("https://app.example.org/e/parish-retreat")
  expect(html).toContain("Anna")
})
