/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BookingList } from "@/components/venue-usage/BookingList"
import { setVenueUsageStatus } from "@/lib/actions/venueUsage"

jest.mock("@/lib/actions/venueUsage", () => ({ setVenueUsageStatus: jest.fn(), deleteVenueUsage: jest.fn() }))
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  unstable_rethrow: jest.fn(),
}))

const rows = [
  { id: 1, date: "2026-11-01", startTime: "17:00", endTime: "20:00", status: "REQUESTED" as const, purpose: "Service", notes: null, bookingRequestedAt: null },
  { id: 2, date: "2026-11-08", startTime: "17:00", endTime: "20:00", status: "REQUESTED" as const, purpose: null, notes: null, bookingRequestedAt: "2026-10-20T01:00:00.000Z" },
  { id: 3, date: "2026-11-15", startTime: "17:00", endTime: "20:00", status: "CANCELLED" as const, purpose: null, notes: null, bookingRequestedAt: null },
]
/** Render the list with a spy for results. */
const setup = () => {
  const onResult = jest.fn()
  render(<BookingList rows={rows} onEdit={jest.fn()} onResult={onResult} />)
  return onResult
}
beforeEach(() => {
  jest.clearAllMocks()
  ;(setVenueUsageStatus as jest.Mock).mockResolvedValue({ success: "ok" })
})

it("shows 'asked on' only for requested rows that were included in a request, and no Cancel on cancelled rows", () => {
  setup()
  expect(screen.getByText(/asked on Tue 20 Oct 2026/i)).toBeInTheDocument()
  expect(screen.getAllByText(/asked on/i)).toHaveLength(1)
  expect(screen.getAllByRole("button", { name: /^cancel$/i })).toHaveLength(2)
})
it("bulk 'Mark confirmed' sends the selected ids", async () => {
  const user = userEvent.setup()
  const onResult = setup()
  await user.click(screen.getByRole("checkbox", { name: /select sunday, 1 november/i }))
  await user.click(screen.getByRole("checkbox", { name: /select sunday, 8 november/i }))
  await user.click(screen.getByRole("button", { name: /mark confirmed/i }))
  await waitFor(() => expect(setVenueUsageStatus).toHaveBeenCalledWith([1, 2], "CONFIRMED"))
  expect(onResult).toHaveBeenCalledWith({ success: "ok" })
})
it("cancelling asks whether to email the venue and passes the choice", async () => {
  const user = userEvent.setup()
  setup()
  await user.click(screen.getAllByRole("button", { name: /^cancel$/i })[0])
  expect(screen.getByText(/email venue about this cancellation/i)).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /cancel and email venue/i }))
  await waitFor(() => expect(setVenueUsageStatus).toHaveBeenCalledWith([1], "CANCELLED", { emailVenue: true }))
  await user.click(screen.getAllByRole("button", { name: /^cancel$/i })[0])
  await user.click(screen.getByRole("button", { name: /cancel without emailing/i }))
  await waitFor(() => expect(setVenueUsageStatus).toHaveBeenLastCalledWith([1], "CANCELLED", { emailVenue: false }))
})
it("surfaces a warning from the action", async () => {
  ;(setVenueUsageStatus as jest.Mock).mockResolvedValue({ success: "Cancelled 1 date", warning: "Could not email the venue." })
  const user = userEvent.setup()
  setup()
  await user.click(screen.getAllByRole("button", { name: /^cancel$/i })[0])
  await user.click(screen.getByRole("button", { name: /cancel without emailing/i }))
  expect(await screen.findByText(/could not email the venue/i)).toBeInTheDocument()
})
it("shows 'No bookings to change' as information, not an error", async () => {
  ;(setVenueUsageStatus as jest.Mock).mockResolvedValue({ error: "No bookings to change" })
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole("checkbox", { name: /select sunday, 1 november/i }))
  await user.click(screen.getByRole("button", { name: /mark confirmed/i }))
  const msg = await screen.findByText(/no bookings to change/i)
  expect(msg).toHaveAttribute("role", "status")
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})
it("shows a real error as an alert", async () => {
  ;(setVenueUsageStatus as jest.Mock).mockResolvedValue({ error: "Unauthorized" })
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole("checkbox", { name: /select sunday, 1 november/i }))
  await user.click(screen.getByRole("button", { name: /mark confirmed/i }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized")
})
