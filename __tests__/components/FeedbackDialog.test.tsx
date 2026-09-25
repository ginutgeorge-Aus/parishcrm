/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react"
import { FeedbackDialog } from "@/components/layout/FeedbackDialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { submitFeedback } from "@/lib/actions/feedback"

jest.mock("@/lib/actions/feedback", () => ({ submitFeedback: jest.fn() }))
jest.mock("next/navigation", () => ({ usePathname: () => "/families" }))
const mockSubmit = submitFeedback as jest.Mock

beforeEach(() => {
  jest.useFakeTimers()
  mockSubmit.mockReset()
})
afterEach(() => {
  act(() => { jest.runOnlyPendingTimers() })
  jest.useRealTimers()
})

test("a submit that resolves after close+reopen does not clobber the new draft", async () => {
  let resolveSubmit: (v: unknown) => void = () => {}
  mockSubmit.mockImplementation(() => new Promise((r) => { resolveSubmit = r }))

  render(<FeedbackDialog />)
  fireEvent.click(screen.getByRole("button", { name: "Feedback" })) // open (BUG default)

  fireEvent.change(screen.getByLabelText(/what were you doing/i), { target: { value: "editing" } })
  fireEvent.change(screen.getByLabelText(/what did you expect/i), { target: { value: "save" } })
  fireEvent.change(screen.getByLabelText(/what actually happened/i), { target: { value: "error" } })
  fireEvent.click(screen.getByRole("button", { name: "Submit" })) // request now in flight

  // Close then reopen while the request is still pending, and start a new draft.
  fireEvent.click(screen.getByRole("button", { name: /close/i }))
  fireEvent.click(screen.getByRole("button", { name: "Feedback" }))
  fireEvent.change(screen.getByLabelText(/what were you doing/i), { target: { value: "NEW draft" } })

  // The earlier request resolves — its result belongs to a closed session.
  await act(async () => { resolveSubmit({ success: "Report filed" }) })

  // No stale banner, new draft preserved, and no armed auto-close.
  expect(screen.queryByText("Report filed")).not.toBeInTheDocument()
  expect(screen.getByLabelText(/what were you doing/i)).toHaveValue("NEW draft")
  act(() => { jest.advanceTimersByTime(3000) })
  expect(screen.getByText("Send Feedback")).toBeInTheDocument() // still open
})

test("collapsed variant still renders a Feedback trigger, icon-only with a tooltip", () => {
  render(
    <TooltipProvider>
      <FeedbackDialog collapsed />
    </TooltipProvider>
  )
  const trigger = screen.getByRole("button", { name: "Feedback" })
  expect(trigger).toBeInTheDocument()
  expect(trigger.closest('[data-slot="tooltip-trigger"]')).not.toBeNull()

  fireEvent.click(trigger)
  expect(screen.getByText("Send Feedback")).toBeInTheDocument()
})
