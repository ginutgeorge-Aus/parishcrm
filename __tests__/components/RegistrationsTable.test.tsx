import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RegistrationsTable } from "@/components/events/RegistrationsTable"
import { cancelRegistration } from "@/lib/actions/registration"

jest.mock("@/lib/actions/registration", () => ({
  markPaid: jest.fn().mockResolvedValue({}),
  cancelRegistration: jest.fn().mockResolvedValue({}),
}))

const reg = (id: number, status: string, paymentRef: string | null = null) => ({
  id,
  firstName: `First${id}`,
  lastName: `Last${id}`,
  email: `e${id}@x.com`,
  phone: null,
  totalAmount: 10,
  paymentStatus: status,
  paymentRef,
  createdAt: new Date("2026-01-01"),
  items: [{ quantity: 1, ticketType: { name: "Adult" }, attendees: [{ name: `First${id} Last${id}` }] }],
})

describe("RegistrationsTable Cancel confirmation", () => {
  beforeEach(() => jest.clearAllMocks())

  it("does not fire cancelRegistration until the confirm dialog is accepted", async () => {
    render(<RegistrationsTable registrations={[reg(1, "PENDING")] as never} eventId={9} canEdit />)
    const table = screen.getByRole("table")
    await userEvent.click(within(table).getByRole("button", { name: "Cancel" }))
    // Dialog open, action not yet fired
    expect(cancelRegistration).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Cancel registration" }))
    expect(cancelRegistration).toHaveBeenCalledWith(1, 9)
  })
})

describe("RegistrationsTable All tab hides cancelled", () => {
  it("hides CANCELLED rows under All, shows them under Cancelled", async () => {
    render(
      <RegistrationsTable
        registrations={[reg(1, "PAID"), reg(2, "CANCELLED")] as never}
        eventId={9}
        canEdit
      />,
    )
    const table = screen.getByRole("table")
    // Default All tab: cancelled hidden
    expect(within(table).getByText("First1 Last1")).toBeInTheDocument()
    expect(within(table).queryByText("First2 Last2")).not.toBeInTheDocument()

    // Cancelled tab: only cancelled shown
    await userEvent.click(screen.getByRole("button", { name: "Cancelled" }))
    expect(within(table).queryByText("First1 Last1")).not.toBeInTheDocument()
    expect(within(table).getByText("First2 Last2")).toBeInTheDocument()
  })
})

describe("RegistrationsTable payment method column", () => {
  it("shows Card when paymentRef is set, Bank transfer when null", () => {
    render(
      <RegistrationsTable
        registrations={[reg(1, "PAID", "pi_abc"), reg(2, "PAID", null)] as never}
        eventId={9}
        canEdit
      />,
    )
    expect(screen.getByText("Card")).toBeInTheDocument()
    expect(screen.getByText("Bank transfer")).toBeInTheDocument()
  })
})
