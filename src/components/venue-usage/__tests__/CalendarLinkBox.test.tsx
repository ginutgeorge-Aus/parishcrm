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

const NEW_URL = "https://app.example.com/venue/new"

it("never shows a stored link: an editor sees only that a link is active, with no reset", () => {
  render(<CalendarLinkBox active canReset={false} />)
  expect(screen.getByText(/calendar link is active/i)).toBeInTheDocument()
  expect(screen.queryByLabelText("Calendar link")).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /reset link/i })).not.toBeInTheDocument()
})
async function resetAndShow() {
  ;(resetVenueCalendarLink as jest.Mock).mockResolvedValue({ success: "Calendar link reset", url: NEW_URL })
  const user = userEvent.setup()
  render(<CalendarLinkBox active canReset />)
  await user.click(screen.getByRole("button", { name: /reset link/i }))
  await user.click(await screen.findByRole("button", { name: /^reset$/i }))
  await screen.findByDisplayValue(NEW_URL)
  return user
}
it("shows the new link once after a reset, with a copy-now notice", async () => {
  await resetAndShow()
  expect(screen.getByDisplayValue(NEW_URL)).toHaveAttribute("readonly")
  expect(screen.getByText(/not shown again/i)).toBeInTheDocument()
})
it("copies the new link", async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  const user = await resetAndShow()
  jest.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText)
  await user.click(screen.getByRole("button", { name: /copy link/i }))
  expect(writeText).toHaveBeenCalledWith(NEW_URL)
  expect(await screen.findByText(/copied/i)).toBeInTheDocument()
})
it("falls back to selecting the input when copying fails", async () => {
  const user = await resetAndShow()
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
  render(<CalendarLinkBox active canReset />)
  await user.click(screen.getByRole("button", { name: /reset link/i }))
  expect(await screen.findByText(/old link will stop working/i)).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /^reset$/i }))
  await waitFor(() => expect(resetVenueCalendarLink).toHaveBeenCalled())
  await waitFor(() => expect(refresh).toHaveBeenCalled())
})
it("keeps the dialog open and shows the error when reset fails", async () => {
  ;(resetVenueCalendarLink as jest.Mock).mockResolvedValue({ error: "Not allowed" })
  const user = userEvent.setup()
  render(<CalendarLinkBox active canReset />)
  await user.click(screen.getByRole("button", { name: /reset link/i }))
  await user.click(await screen.findByRole("button", { name: /^reset$/i }))
  expect(await screen.findByText("Not allowed")).toBeInTheDocument()
  expect(refresh).not.toHaveBeenCalled()
})
it("offers Create link to an admin when none exists, and nothing to an editor", () => {
  const { rerender } = render(<CalendarLinkBox active={false} canReset />)
  expect(screen.getByRole("button", { name: /create link/i })).toBeInTheDocument()
  rerender(<CalendarLinkBox active={false} canReset={false} />)
  expect(screen.getByText(/no calendar link yet/i)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /create link/i })).not.toBeInTheDocument()
})
