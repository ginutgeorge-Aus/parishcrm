import { render, screen } from "@testing-library/react"
import { SendPaymentRemindersClient } from "@/components/events/SendPaymentRemindersClient"

jest.mock("@/lib/actions/registration", () => ({ sendPaymentReminders: jest.fn() }))

test("no button when there are no pending rows", () => {
  const { container } = render(
    <SendPaymentRemindersClient eventId={10} eventTitle="Retreat" rows={[]} />
  )
  expect(container).toBeEmptyDOMElement()
})

test("renders the trigger when pending rows exist", () => {
  render(
    <SendPaymentRemindersClient
      eventId={10}
      eventTitle="Retreat"
      rows={[{ registrationId: 1, name: "Anna", email: "anna@x.org", amountDue: 25, lastRemindedAt: null }]}
    />
  )
  expect(screen.getByRole("button", { name: /email unpaid registrants/i })).toBeInTheDocument()
})
