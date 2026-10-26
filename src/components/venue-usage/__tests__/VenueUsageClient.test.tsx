/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { VenueUsageClient } from "@/components/venue-usage/VenueUsageClient"
import { addAllSundays, createVenueUsage, getVenueRequestPreview } from "@/lib/actions/venueUsage"
import { getBookingRequestPreview, approveVenueMonth } from "@/lib/actions/venueBookings"

jest.mock("@/lib/actions/venueUsage", () => ({
  createVenueUsage: jest.fn(),
  updateVenueUsage: jest.fn(),
  deleteVenueUsage: jest.fn(),
  addAllSundays: jest.fn(),
  setVenueUsageStatus: jest.fn(),
  getVenueRequestPreview: jest.fn().mockResolvedValue({ error: "skip" }),
  sendVenueUsageRequest: jest.fn(),
}))
jest.mock("@/lib/actions/venueBookings", () => ({
  getBookingRequestPreview: jest.fn().mockResolvedValue({ error: "skip" }),
  sendBookingRequest: jest.fn(),
  approveVenueMonth: jest.fn(),
  withdrawVenueApproval: jest.fn(),
}))
jest.mock("@/lib/actions/venueCalendar", () => ({ resetVenueCalendarLink: jest.fn() }))
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  unstable_rethrow: jest.fn(),
}))

/** Render the screen for November 2026 with no rows. */
const element = (month = "2026-11") => (
  <VenueUsageClient month={month} today="2026-10-25" nextSunday="2026-11-01" defaultRequestMonth="2026-10" rows={[]} calendarUrl="https://app.example.com/venue/tok" canResetCalendar={false} />
)
const setup = () => render(element())

beforeEach(() => jest.clearAllMocks())

it("add-all button calls addAllSundays with the form's month, times and purpose", async () => {
  ;(addAllSundays as jest.Mock).mockResolvedValue({ success: "Added 4 Sundays" })
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole("button", { name: "Add all Sundays in November 2026" }))
  await waitFor(() =>
    expect(addAllSundays).toHaveBeenCalledWith({ month: "2026-11", startTime: "17:00", endTime: "20:00", purpose: "" }),
  )
})
it("shows the re-approve notice when a result clears the approval", async () => {
  ;(createVenueUsage as jest.Mock).mockResolvedValue({ success: "Booking added", approvalCleared: true })
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole("button", { name: "Add booking" }))
  expect(await screen.findByText(/Approval cleared/)).toHaveAttribute("role", "status")
})
it("renders the calendar link box with the supplied link", () => {
  setup()
  expect(screen.getByDisplayValue("https://app.example.com/venue/tok")).toBeInTheDocument()
})

it("refetches both panels after a successful mutation", async () => {
  ;(createVenueUsage as jest.Mock).mockResolvedValue({ success: "Booking added" })
  const user = userEvent.setup()
  setup()
  await waitFor(() => expect(getBookingRequestPreview).toHaveBeenCalled())
  await waitFor(() => expect(getVenueRequestPreview).toHaveBeenCalled())
  const b = (getBookingRequestPreview as jest.Mock).mock.calls.length
  const i = (getVenueRequestPreview as jest.Mock).mock.calls.length
  await user.click(screen.getByRole("button", { name: "Add booking" }))
  await waitFor(() => expect((getBookingRequestPreview as jest.Mock).mock.calls.length).toBeGreaterThan(b))
  await waitFor(() => expect((getVenueRequestPreview as jest.Mock).mock.calls.length).toBeGreaterThan(i))
})
it("does not refetch the panels when a mutation fails", async () => {
  ;(createVenueUsage as jest.Mock).mockResolvedValue({ error: "bad" })
  const user = userEvent.setup()
  setup()
  await waitFor(() => expect(getBookingRequestPreview).toHaveBeenCalled())
  await waitFor(() => expect(getVenueRequestPreview).toHaveBeenCalled())
  const b = (getBookingRequestPreview as jest.Mock).mock.calls.length
  await user.click(screen.getByRole("button", { name: "Add booking" }))
  await screen.findByText("bad")
  expect((getBookingRequestPreview as jest.Mock).mock.calls.length).toBe(b)
})
it("clears the approval notice when the month changes", async () => {
  ;(createVenueUsage as jest.Mock).mockResolvedValue({ success: "Booking added", approvalCleared: true })
  const user = userEvent.setup()
  const { rerender } = setup()
  await user.click(screen.getByRole("button", { name: "Add booking" }))
  await screen.findByText(/Approval cleared/)
  rerender(element("2026-12"))
  expect(screen.queryByText(/Approval cleared/)).not.toBeInTheDocument()
})
it("clears the approval notice once the month is re-approved", async () => {
  ;(createVenueUsage as jest.Mock).mockResolvedValue({ success: "Booking added", approvalCleared: true })
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({
    month: "2026-10", subject: "s", text: "Hello Pat", to: "venue@example.com", cc: "", replyTo: "o@example.com",
    rowCount: 1, totalHours: 3, blockedReason: null, last: null, isCurrentMonth: true,
    autoSendLabel: "1 November, 9:00 AM", approval: null, canApprove: true, warnings: [], autoSent: false,
  })
  ;(approveVenueMonth as jest.Mock).mockResolvedValue({ success: "Approved" })
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole("button", { name: "Add booking" }))
  await screen.findByText(/Approval cleared/)
  await user.click(await screen.findByRole("button", { name: /approve automatic send/i }))
  await user.click(await screen.findByRole("button", { name: /^approve$/i }))
  await waitFor(() => expect(screen.queryByText(/Approval cleared/)).not.toBeInTheDocument())
})
it("shows a retry message when saving throws", async () => {
  ;(createVenueUsage as jest.Mock).mockRejectedValue(new Error("network"))
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole("button", { name: "Add booking" }))
  expect(await screen.findByText("Could not save the booking. Please try again.")).toBeInTheDocument()
})
