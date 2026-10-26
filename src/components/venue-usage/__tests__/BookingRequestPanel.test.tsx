/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BookingRequestPanel } from "@/components/venue-usage/BookingRequestPanel"
import { getBookingRequestPreview, sendBookingRequest } from "@/lib/actions/venueBookings"

jest.mock("@/lib/actions/venueBookings", () => ({
  getBookingRequestPreview: jest.fn(),
  sendBookingRequest: jest.fn(),
}))
jest.mock("next/navigation", () => ({ unstable_rethrow: jest.fn() }))

const preview = {
  candidates: [
    { id: 1, date: "2026-11-01", startTime: "17:00", endTime: "20:00", purpose: null },
    { id: 2, date: "2026-11-08", startTime: "17:00", endTime: "20:00", purpose: "Sunday service" },
  ],
  selectedIds: [1, 2],
  asked: [{ id: 3, date: "2026-10-25", askedOn: "2026-10-20" }],
  booked: ["Sunday, 18 October: 5:00 PM – 8:00 PM"],
  subject: "Booking request",
  text: "Hello Pat, please book these dates.",
  to: "venue@example.com",
  cc: "",
  replyTo: "office@example.com",
  blockedReason: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getBookingRequestPreview as jest.Mock).mockResolvedValue(preview)
})

it("ticks every new date by default and lists already-asked dates with the asked-on date", async () => {
  render(<BookingRequestPanel />)
  expect(await screen.findByRole("checkbox", { name: /sunday, 1 november/i })).toBeChecked()
  expect(screen.getByRole("checkbox", { name: /sunday, 8 november/i })).toBeChecked()
  expect(screen.getByText(/asked on Tuesday, 20 October/i)).toBeInTheDocument()
})
it("reloads the preview with only the ticked dates", async () => {
  const user = userEvent.setup()
  render(<BookingRequestPanel />)
  await user.click(await screen.findByRole("checkbox", { name: /sunday, 1 november/i }))
  await waitFor(() => expect(getBookingRequestPreview).toHaveBeenLastCalledWith([2]))
})
it("sends the ticked ids after confirmation and shows the result", async () => {
  ;(sendBookingRequest as jest.Mock).mockResolvedValue({ success: "Booking request sent for 2 dates" })
  const user = userEvent.setup()
  render(<BookingRequestPanel />)
  await user.click(await screen.findByRole("button", { name: /send request/i }))
  await user.click(await screen.findByRole("button", { name: /^send$/i }))
  await waitFor(() => expect(sendBookingRequest).toHaveBeenCalledWith([1, 2]))
  expect(await screen.findByText("Booking request sent for 2 dates")).toBeInTheDocument()
})
it("disables sending and explains why when blocked", async () => {
  ;(getBookingRequestPreview as jest.Mock).mockResolvedValue({ ...preview, selectedIds: [], blockedReason: "Tick at least one date" })
  render(<BookingRequestPanel />)
  expect(await screen.findByText("Tick at least one date")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /send request/i })).not.toBeInTheDocument()
})
it("shows an empty state when there is nothing to request", async () => {
  ;(getBookingRequestPreview as jest.Mock).mockResolvedValue({ ...preview, candidates: [], selectedIds: [], blockedReason: "Tick at least one date" })
  render(<BookingRequestPanel />)
  expect(await screen.findByText(/no new dates to request/i)).toBeInTheDocument()
})
it("refetches the preview when dataVersion changes", async () => {
  const { rerender } = render(<BookingRequestPanel dataVersion={0} />)
  await screen.findByRole("checkbox", { name: /sunday, 1 november/i })
  const before = (getBookingRequestPreview as jest.Mock).mock.calls.length
  rerender(<BookingRequestPanel dataVersion={1} />)
  await waitFor(() => expect((getBookingRequestPreview as jest.Mock).mock.calls.length).toBeGreaterThan(before))
})
it("calls onSent after a successful send", async () => {
  ;(sendBookingRequest as jest.Mock).mockResolvedValue({ success: "Booking request sent for 2 dates" })
  const onSent = jest.fn()
  const user = userEvent.setup()
  render(<BookingRequestPanel onSent={onSent} />)
  await user.click(await screen.findByRole("button", { name: /send request/i }))
  await user.click(await screen.findByRole("button", { name: /^send$/i }))
  await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
})
it("names each checkbox with its times so same-date rows are distinct", async () => {
  render(<BookingRequestPanel />)
  expect(await screen.findByRole("checkbox", { name: /sunday, 1 november.* to /i })).toBeInTheDocument()
})
it("disables sending when no date is ticked", async () => {
  // Refetched preview with nothing selected and no blockedReason yet.
  ;(getBookingRequestPreview as jest.Mock).mockResolvedValueOnce(preview).mockResolvedValue({ ...preview, selectedIds: [] })
  const user = userEvent.setup()
  render(<BookingRequestPanel />)
  await user.click(await screen.findByRole("checkbox", { name: /sunday, 1 november/i }))
  await waitFor(() => expect(screen.getByRole("button", { name: /send request/i })).toBeDisabled())
})
