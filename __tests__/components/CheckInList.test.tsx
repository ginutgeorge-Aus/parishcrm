import { render, screen, fireEvent, act } from "@testing-library/react"
import { CheckInList } from "@/components/events/CheckInList"

jest.mock("@/lib/actions/registration", () => ({ toggleAttendeeCheckIn: jest.fn().mockResolvedValue(undefined) }))
import { toggleAttendeeCheckIn } from "@/lib/actions/registration"

const attendees = [
  { attendeeId: 1, name: "Ann Lee", ticketName: "Adult", registrantName: "Ann Lee", ref: "REG-AAA", checkedIn: false },
  { attendeeId: 2, name: "Bob Reed", ticketName: "Adult", registrantName: "Ann Lee", ref: "REG-AAA", checkedIn: true },
]

beforeEach(() => { jest.clearAllMocks() })

it("shows live checked-in count", () => {
  render(<CheckInList eventId={1} attendees={attendees} />)
  expect(screen.getByText(/1 \/ 2 checked in/i)).toBeInTheDocument()
})

it("filters by name", () => {
  render(<CheckInList eventId={1} attendees={attendees} />)
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "bob" } })
  expect(screen.queryByText("Ann Lee")).not.toBeInTheDocument()
  expect(screen.getByText("Bob Reed")).toBeInTheDocument()
})

it("filters by ref", () => {
  render(<CheckInList eventId={1} attendees={attendees} />)
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "reg-aaa" } })
  expect(screen.getByText("Ann Lee")).toBeInTheDocument()
  expect(screen.getByText("Bob Reed")).toBeInTheDocument()
})

it("toggles check-in and calls the action", () => {
  render(<CheckInList eventId={1} attendees={attendees} />)
  fireEvent.click(screen.getByRole("button", { name: /check in ann lee/i }))
  expect(toggleAttendeeCheckIn).toHaveBeenCalledWith(1, 1, true)
})

it("disables the toggle while a request is pending and ignores a rapid second click", async () => {
  let resolveToggle: (value: undefined) => void = () => {}
  ;(toggleAttendeeCheckIn as jest.Mock).mockImplementation(
    () => new Promise<undefined>(resolve => { resolveToggle = resolve }),
  )
  render(<CheckInList eventId={1} attendees={attendees} />)
  const button = screen.getByRole("button", { name: /check in ann lee/i })

  fireEvent.click(button)
  expect(button).toBeDisabled()

  // Double-click while the first request is still in flight — must not
  // fire a second overlapping toggle call.
  fireEvent.click(button)
  expect(toggleAttendeeCheckIn).toHaveBeenCalledTimes(1)

  await act(async () => {
    resolveToggle(undefined)
    await Promise.resolve()
  })
  expect(button).not.toBeDisabled()
})

it("reverts the optimistic check-in and shows an error when the action rejects", async () => {
  ;(toggleAttendeeCheckIn as jest.Mock).mockRejectedValueOnce(new Error("network"))
  render(<CheckInList eventId={1} attendees={attendees} />)

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /check in ann lee/i }))
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(screen.getByRole("button", { name: /check in ann lee/i })).toBeInTheDocument()
  expect(screen.getByRole("alert")).toBeInTheDocument()
})

it("reconciles with a refreshed attendee list — new rows, server-side check-ins", () => {
  const { rerender } = render(<CheckInList eventId={1} attendees={attendees} />)
  const refreshed = [
    { ...attendees[0], checkedIn: true }, // checked in on another device
    attendees[1],
    { attendeeId: 3, name: "Cat Day", ticketName: "Adult", registrantName: "Cat Day", ref: "REG-BBB", checkedIn: true },
  ]
  rerender(<CheckInList eventId={1} attendees={refreshed} />)
  expect(screen.getByText(/3 \/ 3 checked in/i)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /check out ann lee/i })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /^check in ann lee/i })).not.toBeInTheDocument()
})

it("drops removed attendees from the count after a refresh", () => {
  const { rerender } = render(<CheckInList eventId={1} attendees={attendees} />)
  rerender(<CheckInList eventId={1} attendees={[attendees[0]]} />)
  expect(screen.getByText(/0 \/ 1 checked in/i)).toBeInTheDocument()
})
