/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { VenueUsageClient, liveToday } from "@/components/venue-usage/VenueUsageClient"
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
// The live Sydney "today" the client re-reads when a row is opened; defaults to the server-rendered value.
jest.mock("@/lib/dates", () => ({ ...jest.requireActual("@/lib/dates"), sydneyTodayYMD: jest.fn(() => "2026-10-25") }))
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

/**
 * Render with one venue-known row and open it for editing.
 * @param date the row's date (today in these tests is 2026-10-25)
 */
async function editKnownRow(date: string) {
  const row = { id: 3, date, startTime: "17:00", endTime: "20:00", status: "CONFIRMED" as const, purpose: null, notes: null, bookingRequestedAt: "2026-10-01T00:00:00.000Z", venueKnows: true }
  const user = userEvent.setup()
  render(<VenueUsageClient month={date.slice(0, 7)} today="2026-10-25" nextSunday="2026-11-01" defaultRequestMonth="2026-10" rows={[row]} calendarUrl="https://app.example.com/venue/tok" canResetCalendar={false} />)
  await user.click(screen.getByRole("button", { name: "Edit" }))
  return user
}

describe("venue-known row edit locks", () => {
  it("past row: times enabled, date disabled", async () => {
    await editKnownRow("2026-10-11")
    expect(screen.getByLabelText("Date")).toBeDisabled()
    expect(screen.getByLabelText("Start")).toBeEnabled()
    expect(screen.getByLabelText("End")).toBeEnabled()
  })
  it("same-day row: date and times all locked", async () => {
    await editKnownRow("2026-10-25")
    expect(screen.getByLabelText("Date")).toBeDisabled()
    expect(screen.getByLabelText("Start")).toBeDisabled()
    expect(screen.getByLabelText("End")).toBeDisabled()
  })
  it("page left open past Sydney midnight: opening the row re-reads today, so yesterday's times unlock (#510)", async () => {
    const { sydneyTodayYMD } = jest.requireMock("@/lib/dates")
    sydneyTodayYMD.mockReturnValue("2026-10-26")
    try {
      await editKnownRow("2026-10-25") // rendered with today=2026-10-25
      expect(screen.getByLabelText("Date")).toBeDisabled()
      expect(screen.getByLabelText("Start")).toBeEnabled()
      expect(screen.getByLabelText("End")).toBeEnabled()
    } finally {
      sydneyTodayYMD.mockReturnValue("2026-10-25")
    }
  })
  it("a client clock behind the server never relocks: the later of the two days wins", async () => {
    const { sydneyTodayYMD } = jest.requireMock("@/lib/dates")
    sydneyTodayYMD.mockReturnValue("2026-10-20")
    try {
      await editKnownRow("2026-10-24")
      expect(screen.getByLabelText("Start")).toBeEnabled()
    } finally {
      sydneyTodayYMD.mockReturnValue("2026-10-25")
    }
  })
  it("future row: date and times all locked", async () => {
    await editKnownRow("2026-11-01")
    expect(screen.getByLabelText("Date")).toBeDisabled()
    expect(screen.getByLabelText("Start")).toBeDisabled()
    expect(screen.getByLabelText("End")).toBeDisabled()
  })
  it("shows a warning returned by the update", async () => {
    const { updateVenueUsage } = jest.requireMock("@/lib/actions/venueUsage")
    updateVenueUsage.mockResolvedValue({ success: "Booking updated", warning: "Changes saved, but the invoice request was already sent." })
    const user = await editKnownRow("2026-10-11")
    await user.click(screen.getByRole("button", { name: "Save changes" }))
    const warning = await screen.findByText(/invoice request was already sent/)
    expect(warning).toHaveAttribute("role", "alert")
    expect(warning).toHaveClass("text-destructive")
  })
})

describe("Sydney today refresh for new bookings (#528)", () => {
  const dates = () => jest.requireMock("@/lib/dates").sydneyTodayYMD as jest.Mock
  afterEach(() => dates().mockReturnValue("2026-10-25"))

  it("page left open past midnight: picking the new current day suggests CONFIRMED, not REQUESTED", async () => {
    const user = userEvent.setup()
    setup() // rendered with today=2026-10-25
    dates().mockReturnValue("2026-10-26")
    const date = screen.getByLabelText("Date")
    await user.clear(date)
    await user.type(date, "2026-10-26")
    expect(screen.getByLabelText("Status")).toHaveValue("CONFIRMED")
  })

  it("cancelling an edit resets the form with the refreshed day", async () => {
    const user = userEvent.setup()
    const row = { id: 4, date: "2026-10-11", startTime: "17:00", endTime: "20:00", status: "CONFIRMED" as const, purpose: null, notes: null, bookingRequestedAt: null, venueKnows: false }
    render(<VenueUsageClient month="2026-10" today="2026-10-31" nextSunday="2026-11-01" defaultRequestMonth="2026-10" rows={[row]} calendarUrl="https://app.example.com/venue/tok" canResetCalendar={false} />)
    expect(screen.getByLabelText("Status")).toHaveValue("REQUESTED") // next Sunday is after the server day
    dates().mockReturnValue("2026-11-01")
    await user.click(screen.getByRole("button", { name: "Edit" }))
    await user.click(screen.getByRole("button", { name: "Cancel edit" }))
    expect(screen.getByLabelText("Status")).toHaveValue("CONFIRMED") // next Sunday is now today
  })
})

describe("liveToday", () => {
  const dates = () => jest.requireMock("@/lib/dates").sydneyTodayYMD as jest.Mock
  afterEach(() => dates().mockReturnValue("2026-10-25"))

  it("a client clock behind the server keeps the server day", () => {
    dates().mockReturnValue("2026-10-20")
    expect(liveToday("2026-10-25", 0)).toBe("2026-10-25")
  })
  it("one day past the server day is allowed straight away (rendered just before midnight)", () => {
    dates().mockReturnValue("2026-10-26")
    expect(liveToday("2026-10-25", 1000)).toBe("2026-10-26")
  })
  it("a client clock running days ahead is capped at the real elapsed time plus one day", () => {
    dates().mockReturnValue("2026-11-05")
    expect(liveToday("2026-10-25", 1000)).toBe("2026-10-26")
    expect(liveToday("2026-10-25", 2 * 86_400_000 + 5)).toBe("2026-10-28")
    expect(liveToday("2026-10-25", -50)).toBe("2026-10-26")
  })
})
