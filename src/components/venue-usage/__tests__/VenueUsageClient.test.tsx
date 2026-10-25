/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { VenueUsageClient } from "@/components/venue-usage/VenueUsageClient"
import { addAllSundays, createVenueUsage } from "@/lib/actions/venueUsage"

jest.mock("@/lib/actions/venueUsage", () => ({
  createVenueUsage: jest.fn(),
  updateVenueUsage: jest.fn(),
  deleteVenueUsage: jest.fn(),
  addAllSundays: jest.fn(),
  setVenueUsageStatus: jest.fn(),
  getVenueRequestPreview: jest.fn().mockResolvedValue({ error: "skip" }),
  sendVenueUsageRequest: jest.fn(),
}))
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  unstable_rethrow: jest.fn(),
}))

/** Render the screen for November 2026 with no rows. */
const setup = () =>
  render(<VenueUsageClient month="2026-11" today="2026-10-25" nextSunday="2026-11-01" defaultRequestMonth="2026-10" rows={[]} />)

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
