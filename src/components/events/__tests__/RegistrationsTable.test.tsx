import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { RegistrationsTable } from "@/components/events/RegistrationsTable"

jest.mock("@/lib/actions/registration", () => ({
  getRegistrationDetail: jest.fn().mockResolvedValue({
    data: {
      id: 7, firstName: "Jane", lastName: "Doe", email: "jane@x.com", phone: null,
      totalAmount: 20, paymentStatus: "PAID", paymentMethod: "Card",
      orderAnswers: [], attendees: [],
    },
  }),
  markPaid: jest.fn(),
  cancelRegistration: jest.fn(),
}))
import { getRegistrationDetail } from "@/lib/actions/registration"

const regs = [{
  id: 7, firstName: "Jane", lastName: "Doe", email: "jane@x.com", phone: null,
  totalAmount: 20, paymentStatus: "PAID", paymentRef: "pi_1", createdAt: new Date("2026-01-01"),
  items: [{ quantity: 1, ticketType: { name: "Adult" }, attendees: [{ name: "Jane Doe" }] }],
}]

it("opens the detail dialog when the booker name is clicked", async () => {
  render(<RegistrationsTable registrations={regs} eventId={3} canEdit />)
  const table = screen.getByRole("table")
  fireEvent.click(within(table).getByRole("button", { name: /Jane Doe/i }))
  await waitFor(() => expect(getRegistrationDetail).toHaveBeenCalledWith(7))
})
