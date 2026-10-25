/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CalendarLinkBox } from "@/components/venue-usage/CalendarLinkBox"
import { resetVenueCalendarLink } from "@/lib/actions/venueCalendar"

const refresh = jest.fn()
jest.mock("@/lib/actions/venueCalendar", () => ({ resetVenueCalendarLink: jest.fn() }))
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: jest.fn() }),
  unstable_rethrow: jest.fn(),
}))

beforeEach(() => jest.clearAllMocks())

it("shows the link and a copy button to editors but no reset", () => {
  render(<CalendarLinkBox url="https://app.example.com/venue/tok" canReset={false} />)
  expect(screen.getByDisplayValue("https://app.example.com/venue/tok")).toHaveAttribute("readonly")
  expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /reset link/i })).not.toBeInTheDocument()
})
it("copies the link", async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  const user = userEvent.setup()
  render(<CalendarLinkBox url="https://app.example.com/venue/tok" canReset={false} />)
  jest.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText)
  await user.click(screen.getByRole("button", { name: /copy link/i }))
  expect(writeText).toHaveBeenCalledWith("https://app.example.com/venue/tok")
  expect(await screen.findByText(/copied/i)).toBeInTheDocument()
})
it("falls back to selecting the input when copying fails", async () => {
  const user = userEvent.setup()
  render(<CalendarLinkBox url="https://app.example.com/venue/tok" canReset={false} />)
  jest.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"))
  await user.click(screen.getByRole("button", { name: /copy link/i }))
  expect(await screen.findByRole("alert")).toHaveTextContent(/select the link/i)
  const input = screen.getByLabelText("Calendar link") as HTMLInputElement
  expect(input.selectionStart).toBe(0)
  expect(input.selectionEnd).toBe(input.value.length)
})
it("lets an admin reset after confirming, then refreshes", async () => {
  ;(resetVenueCalendarLink as jest.Mock).mockResolvedValue({ success: "Calendar link reset", url: "https://app.example.com/venue/new" })
  const user = userEvent.setup()
  render(<CalendarLinkBox url="https://app.example.com/venue/tok" canReset />)
  await user.click(screen.getByRole("button", { name: /reset link/i }))
  expect(await screen.findByText(/old link will stop working/i)).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /^reset$/i }))
  await waitFor(() => expect(resetVenueCalendarLink).toHaveBeenCalled())
  await waitFor(() => expect(refresh).toHaveBeenCalled())
})
it("keeps the dialog open and shows the error when reset fails", async () => {
  ;(resetVenueCalendarLink as jest.Mock).mockResolvedValue({ error: "Not allowed" })
  const user = userEvent.setup()
  render(<CalendarLinkBox url="https://app.example.com/venue/tok" canReset />)
  await user.click(screen.getByRole("button", { name: /reset link/i }))
  await user.click(await screen.findByRole("button", { name: /^reset$/i }))
  expect(await screen.findByText("Not allowed")).toBeInTheDocument()
  expect(refresh).not.toHaveBeenCalled()
})
it("offers Create link to an admin when none exists, and nothing to an editor", () => {
  const { rerender } = render(<CalendarLinkBox url={null} canReset />)
  expect(screen.getByRole("button", { name: /create link/i })).toBeInTheDocument()
  rerender(<CalendarLinkBox url={null} canReset={false} />)
  expect(screen.getByText(/no calendar link yet/i)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /create link/i })).not.toBeInTheDocument()
})
