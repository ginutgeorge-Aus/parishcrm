/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react"
import { VenueCalendarView } from "@/components/venue-usage/VenueCalendarView"

const entries = [
  { id: 1, date: "2026-11-01", startTime: "17:00", endTime: "20:00", purpose: "Sunday service", status: "CONFIRMED" as const },
  { id: 2, date: "2026-11-08", startTime: "17:00", endTime: "20:30", purpose: null, status: "REQUESTED" as const },
]
it("renders the venue name, a list with date/time/purpose and text labels", () => {
  render(<VenueCalendarView venueName="Example Hall" month="2026-11" token="tok" todayYMD="2026-10-25" entries={entries} />)
  expect(screen.getByRole("heading", { name: /example hall/i })).toBeInTheDocument()
  expect(screen.getByText("November 2026")).toBeInTheDocument()
  expect(screen.getByText(/Sunday, 1 November/)).toBeInTheDocument()
  expect(screen.getByText("Sunday service")).toBeInTheDocument()
  expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0)
  expect(screen.getAllByText("Pending").length).toBeGreaterThan(0)
})
it("links to the previous and next month with the token", () => {
  render(<VenueCalendarView venueName="Example Hall" month="2026-11" token="tok" todayYMD="2026-10-25" entries={[]} />)
  expect(screen.getByRole("link", { name: /previous month/i })).toHaveAttribute("href", "/venue/tok?month=2026-10")
  expect(screen.getByRole("link", { name: /next month/i })).toHaveAttribute("href", "/venue/tok?month=2026-12")
})
it("disables prev at -12 months and next at +6 months", () => {
  const { rerender } = render(<VenueCalendarView venueName="V" month="2025-10" token="tok" todayYMD="2026-10-25" entries={[]} />)
  expect(screen.queryByRole("link", { name: /previous month/i })).not.toBeInTheDocument()
  rerender(<VenueCalendarView venueName="V" month="2027-04" token="tok" todayYMD="2026-10-25" entries={[]} />)
  expect(screen.queryByRole("link", { name: /next month/i })).not.toBeInTheDocument()
})
it("shows an empty message", () => {
  render(<VenueCalendarView venueName="V" month="2026-11" token="tok" todayYMD="2026-10-25" entries={[]} />)
  expect(screen.getByText(/no bookings this month/i)).toBeInTheDocument()
})
