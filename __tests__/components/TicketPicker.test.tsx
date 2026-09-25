/**
 * @jest-environment jsdom
 *
 * an uncapped (capacity === null) ticket type let a huge typed quantity
 * flow into `Array.from({ length: qty })`, allocating a giant attendee array and
 * freezing the tab. Quantity must be clamped to the per-type max (100, mirroring
 * the server Zod cap).
 */
import { render, screen, fireEvent } from "@testing-library/react"
import { TicketPicker } from "@/components/public-event/TicketPicker"

// Attendee custom-question fields are irrelevant to the quantity clamp.
jest.mock("@/components/public-event/QuestionField", () => ({ QuestionField: () => null }))

const baseProps = {
  soldCounts: {},
  names: {},
  onNameChange: jest.fn(),
  attendeeQuestions: () => [],
  attendeeAnswers: {},
  onAttendeeAnswerChange: jest.fn(),
}

describe("TicketPicker quantity clamp", () => {
  it("clamps a huge quantity on an uncapped ticket to the per-type max (100)", () => {
    const onChange = jest.fn()
    render(
      <TicketPicker
        {...baseProps}
        ticketTypes={[{ id: 1, name: "Adult", price: 0, capacity: null }]}
        quantities={{}}
        onChange={onChange}
      />
    )
    const input = screen.getByLabelText("Adult quantity") as HTMLInputElement
    fireEvent.change(input, { target: { value: "999999" } })
    expect(onChange).toHaveBeenCalledWith(1, 100)
  })

  it("does not render an unbounded number of attendee-name fields", () => {
    render(
      <TicketPicker
        {...baseProps}
        ticketTypes={[{ id: 1, name: "Adult", price: 0, capacity: null }]}
        // Even if state somehow held a huge qty, the picker caps the rendered rows.
        quantities={{ 1: 100 }}
        onChange={jest.fn()}
      />
    )
    // 100 attendee-name inputs + the 1 quantity input = 101, never millions.
    const nameFields = screen.getAllByPlaceholderText(/full name/)
    expect(nameFields).toHaveLength(100)
  })
})

describe("TicketPicker decrease button on a sold-out type", () => {
  it("stays enabled at qty > 0 so an already-selected sold-out type can be reduced to 0", () => {
    const onChange = jest.fn()
    render(
      <TicketPicker
        {...baseProps}
        // capacity 1, 1 sold → soldOut, but qty already 1 (e.g. sold out after selection).
        ticketTypes={[{ id: 1, name: "Adult", price: 0, capacity: 1 }]}
        soldCounts={{ 1: 1 }}
        quantities={{ 1: 1 }}
        onChange={onChange}
      />
    )
    const decrease = screen.getByLabelText("Decrease Adult quantity")
    expect(decrease).not.toBeDisabled()
    fireEvent.click(decrease)
    expect(onChange).toHaveBeenCalledWith(1, 0)
  })

  it("keeps the decrease button disabled once qty reaches 0", () => {
    render(
      <TicketPicker
        {...baseProps}
        ticketTypes={[{ id: 1, name: "Adult", price: 0, capacity: 1 }]}
        soldCounts={{ 1: 1 }}
        quantities={{ 1: 0 }}
        onChange={jest.fn()}
      />
    )
    expect(screen.getByLabelText("Decrease Adult quantity")).toBeDisabled()
  })

  it("keeps the increase button disabled on a sold-out type", () => {
    render(
      <TicketPicker
        {...baseProps}
        ticketTypes={[{ id: 1, name: "Adult", price: 0, capacity: 1 }]}
        soldCounts={{ 1: 1 }}
        quantities={{ 1: 1 }}
        onChange={jest.fn()}
      />
    )
    expect(screen.getByLabelText("Increase Adult quantity")).toBeDisabled()
  })
})

describe("TicketPicker oversold type", () => {
  it("floors remaining at 0 when sold exceeds capacity — sold out, no RangeError", () => {
    // capacity 5 but 8 already sold (e.g. capacity lowered after sales): naive
    // `capacity - sold` = -3. Rendering must not throw (a negative remaining would
    // let qty go negative and blow up `Array.from({ length: qty })`), and the type
    // shows as sold out with the quantity input disabled.
    expect(() =>
      render(
        <TicketPicker
          {...baseProps}
          ticketTypes={[{ id: 1, name: "Adult", price: 0, capacity: 5 }]}
          soldCounts={{ 1: 8 }}
          quantities={{ 1: 0 }}
          onChange={jest.fn()}
        />
      )
    ).not.toThrow()
    expect(screen.getByText(/Sold out/)).toBeInTheDocument()
    expect(screen.getByLabelText("Adult quantity")).toBeDisabled()
  })
})
