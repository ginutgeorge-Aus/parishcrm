import { render, screen, fireEvent } from "@testing-library/react"
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
    // Asterisk is a CSS ::after on the label so the accessible name stays "Adult 1".
    expect(screen.getByText("Adult 1").className).toContain("after:content-")
    expect(screen.getByText("Adult 2")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("reports native-invalid empty names via onNameInvalid", () => {
    const onNameInvalid = jest.fn()
    render(<TicketPicker {...base} names={{ 1: ["", ""] }} onNameInvalid={onNameInvalid} />)
    fireEvent.invalid(screen.getByLabelText(/Adult 1/))
    expect(onNameInvalid).toHaveBeenCalledTimes(1)
  })

  it("shows inline error only for empty names after a blocked submit", () => {
    render(<TicketPicker {...base} names={{ 1: ["Ann", "  "] }} showNameErrors />)
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.getByLabelText(/Adult 2/)).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByLabelText(/Adult 1/)).not.toHaveAttribute("aria-invalid")
  })
})
