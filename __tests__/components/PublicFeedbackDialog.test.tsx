import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PublicFeedbackDialog } from "@/components/public/PublicFeedbackDialog"
import { submitPublicFeedback } from "@/lib/actions/publicFeedback"

jest.mock("@/lib/actions/publicFeedback", () => ({ submitPublicFeedback: jest.fn() }))
jest.mock("next/navigation", () => ({ usePathname: () => "/e/carols" }))

const mockSubmit = submitPublicFeedback as jest.Mock

afterEach(() => jest.clearAllMocks())

function openFeedback() {
  render(<PublicFeedbackDialog />)
  fireEvent.click(screen.getByRole("button", { name: /report a problem/i }))
  fireEvent.click(screen.getByRole("button", { name: "Feedback" }))
  fireEvent.change(screen.getByLabelText(/your feedback/i), { target: { value: "great app" } })
}

it("opens the dialog and switches between Bug and Feedback fields", () => {
  render(<PublicFeedbackDialog />)
  fireEvent.click(screen.getByRole("button", { name: /report a problem/i }))
  // Bug is the default — shows the three guided prompts.
  expect(screen.getByLabelText(/what were you doing/i)).toBeInTheDocument()
  // Switch to Feedback.
  fireEvent.click(screen.getByRole("button", { name: "Feedback" }))
  expect(screen.getByLabelText(/your feedback/i)).toBeInTheDocument()
  expect(screen.queryByLabelText(/what were you doing/i)).not.toBeInTheDocument()
})

it("renders the success message returned by the action", async () => {
  mockSubmit.mockResolvedValue({ success: "Thanks — your report has been sent." })
  openFeedback()
  fireEvent.click(screen.getByRole("button", { name: "Submit" }))
  expect(await screen.findByText("Thanks — your report has been sent.")).toBeInTheDocument()
})

it("renders the error message when the action fails", async () => {
  mockSubmit.mockResolvedValue({ error: "Too many reports. Please try again later." })
  openFeedback()
  fireEvent.click(screen.getByRole("button", { name: "Submit" }))
  expect(await screen.findByText("Too many reports. Please try again later.")).toBeInTheDocument()
})

it("forwards the hidden honeypot value to the action (bot detection)", async () => {
  mockSubmit.mockResolvedValue({ success: "ok" })
  openFeedback()
  const honeypot = document.querySelector('input[name="website"]') as HTMLInputElement
  expect(honeypot).toHaveAttribute("aria-hidden", "true")
  fireEvent.change(honeypot, { target: { value: "http://spam.example" } })
  fireEvent.click(screen.getByRole("button", { name: "Submit" }))
  await waitFor(() => expect(mockSubmit).toHaveBeenCalled())
  expect(mockSubmit.mock.calls[0][0]).toMatchObject({
    type: "FEEDBACK",
    what: "great app",
    website: "http://spam.example",
  })
})
