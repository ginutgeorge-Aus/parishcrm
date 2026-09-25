/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react"
import { InviteFamilyButton } from "@/components/family-update/InviteFamilyButton"
import { sendFamilyUpdateInvite } from "@/lib/actions/familyUpdate"

jest.mock("@/lib/actions/familyUpdate", () => ({ sendFamilyUpdateInvite: jest.fn() }))
const mockSend = sendFamilyUpdateInvite as jest.Mock

beforeEach(() => {
  jest.useFakeTimers()
  mockSend.mockReset()
})
afterEach(() => {
  act(() => { jest.runOnlyPendingTimers() })
  jest.useRealTimers()
})

test("reopening within the 2.5s auto-close window does not force-close the dialog", async () => {
  mockSend.mockResolvedValue(undefined) // success (no error)
  render(<InviteFamilyButton familyId={1} defaultEmail="fam@example.com" />)

  fireEvent.click(screen.getByRole("button", { name: /invite family/i })) // open
  fireEvent.click(screen.getByRole("button", { name: /send invite/i })) // submit
  await act(async () => {}) // flush the submit promise -> success + arm auto-close
  expect(screen.getByText("Invite sent")).toBeInTheDocument()

  // Close, then reopen within the window — the pending one-shot must be cancelled.
  fireEvent.click(screen.getByRole("button", { name: /close/i }))
  fireEvent.click(screen.getByRole("button", { name: /invite family/i }))

  act(() => { jest.advanceTimersByTime(3000) }) // past the original 2.5s timer

  // Dialog must still be open — not force-closed out from under the user.
  expect(screen.getByText("Send update invite")).toBeInTheDocument()
})
