import { render, screen } from "@testing-library/react"
import { TicketPicker } from "../TicketPicker"

const tt = { id: 1, name: "Adult", price: 0, capacity: null }
const base = {
  ticketTypes: [tt],
  soldCounts: {},
  quantities: { 1: 2 },
  onChange: jest.fn(),
  onNameChange: jest.fn(),
  attendeeQuestions: () => [],
  attendeeAnswers: {},
  onAttendeeAnswerChange: jest.fn(),
}

describe("TicketPicker attendee name", () => {
  it("marks each name field required with a visible asterisk", () => {
    render(<TicketPicker {...base} names={{ 1: ["", ""] }} />)
    expect(screen.getByLabelText(/Adult 1/)).toBeRequired()
    expect(screen.getAllByText("*")).toHaveLength(2)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("shows inline error only for empty names after a blocked submit", () => {
    render(<TicketPicker {...base} names={{ 1: ["Ann", "  "] }} showNameErrors />)
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.getByLabelText(/Adult 2/)).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByLabelText(/Adult 1/)).not.toHaveAttribute("aria-invalid")
  })
})
