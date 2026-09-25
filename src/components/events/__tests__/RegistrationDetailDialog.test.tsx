import { render, screen, waitFor } from "@testing-library/react"
import { RegistrationDetailDialog } from "@/components/events/RegistrationDetailDialog"

jest.mock("@/lib/actions/registration", () => ({
  getRegistrationDetail: jest.fn(),
}))
import { getRegistrationDetail } from "@/lib/actions/registration"
const mockGet = getRegistrationDetail as jest.Mock

const detail = {
  id: 7, firstName: "Jane", lastName: "Doe", email: "jane@x.com", phone: "0400000000",
  totalAmount: 20, paymentStatus: "PAID", paymentMethod: "Card",
  orderAnswers: [{ label: "Dietary", value: "Vegan" }],
  attendees: [{ name: "Jane Doe", ticketType: "Adult", checkedIn: true, answers: [{ label: "T-shirt size", value: "L" }] }],
}

beforeEach(() => jest.clearAllMocks())

it("lazy-fetches on open and renders booker, answers, and attendees", async () => {
  mockGet.mockResolvedValue({ data: detail })
  render(<RegistrationDetailDialog registrationId={7} open onOpenChange={() => {}} />)
  // "Jane Doe" appears twice (dialog title + attendee name) — assert presence, not uniqueness.
  await waitFor(() => expect(screen.getAllByText("Jane Doe").length).toBeGreaterThan(0))
  expect(mockGet).toHaveBeenCalledWith(7)
  expect(screen.getByText("jane@x.com")).toBeInTheDocument()
  expect(screen.getByText("Vegan")).toBeInTheDocument()          // order answer
  expect(screen.getByText("T-shirt size")).toBeInTheDocument()   // attendee answer
  expect(screen.getByText("Adult")).toBeInTheDocument()
})

it("shows an error state when the action returns an error", async () => {
  mockGet.mockResolvedValue({ error: "Registration not found" })
  render(<RegistrationDetailDialog registrationId={7} open onOpenChange={() => {}} />)
  await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument())
})

it("does not fetch while closed", () => {
  mockGet.mockResolvedValue({ data: detail })
  render(<RegistrationDetailDialog registrationId={7} open={false} onOpenChange={() => {}} />)
  expect(mockGet).not.toHaveBeenCalled()
})
