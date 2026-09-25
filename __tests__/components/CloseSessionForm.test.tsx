/**
 * @jest-environment jsdom
 *
 * the handover-note Textarea used aria-required (a hint only) instead of
 * HTML required, so an empty submit was allowed natively when a cash-count
 * variance existed. Fixed to required={hasVariance} so the browser blocks it.
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CloseSessionForm } from "@/components/petty-cash/CloseSessionForm"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ back: jest.fn() }),
}))

describe("CloseSessionForm handover note", () => {
  it("does not require the note when no cash count is entered", () => {
    render(<CloseSessionForm action={jest.fn()} balance={100} />)
    expect(screen.getByRole("textbox")).not.toBeRequired()
  })

  it("requires the note when the counted cash creates a variance", async () => {
    const user = userEvent.setup()
    render(<CloseSessionForm action={jest.fn()} balance={100} />)
    const notes = screen.getByRole("textbox")
    expect(notes).not.toBeRequired()

    await user.type(screen.getByRole("spinbutton"), "50") // 50 ≠ 100 → variance
    expect(notes).toBeRequired()
  })

  it("does not require the note when the count matches the balance", async () => {
    const user = userEvent.setup()
    render(<CloseSessionForm action={jest.fn()} balance={100} />)
    await user.type(screen.getByRole("spinbutton"), "100") // matches → no variance
    expect(screen.getByRole("textbox")).not.toBeRequired()
  })
})
