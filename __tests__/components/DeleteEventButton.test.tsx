/**
 * @jest-environment jsdom
 *
 * DeleteEventButton had no pending guard — double-submit possible —
 * and no error handling. The fix adds useTransition with isPending disable,
 * AlertDialog confirmation, and surfaces action errors.
 */
import { render, screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DeleteEventButton } from "@/components/events/DeleteEventButton"

beforeEach(() => jest.clearAllMocks())

async function openDialog(action: jest.Mock) {
  const user = userEvent.setup()
  render(<DeleteEventButton action={action} />)
  await user.click(screen.getByRole("button", { name: "Delete" }))
  const dialog = await screen.findByRole("alertdialog")
  return { user, dialog }
}

describe("DeleteEventButton", () => {
  it("shows AlertDialog before executing action", async () => {
    const action = jest.fn().mockResolvedValue(undefined)
    const { dialog } = await openDialog(action)

    expect(dialog).toBeInTheDocument()
    expect(action).not.toHaveBeenCalled()
  })

  it("closes dialog on success", async () => {
    const action = jest.fn().mockResolvedValue(undefined)
    const { user, dialog } = await openDialog(action)

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(action).toHaveBeenCalledTimes(1)
  })

  it("keeps dialog open and shows error on action failure", async () => {
    const action = jest.fn().mockResolvedValue({ error: "Cannot delete published event." })
    const { user, dialog } = await openDialog(action)

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(await screen.findByText("Cannot delete published event.")).toBeInTheDocument()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })

  it("disables trigger button while pending", async () => {
    let resolve!: (v: undefined) => void
    const action = jest.fn(() => new Promise<undefined>((r) => { resolve = r }))
    const user = userEvent.setup()
    render(<DeleteEventButton action={action} />)
    const trigger = screen.getByRole("button", { name: "Delete" })

    await user.click(trigger)
    const dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(trigger).toBeDisabled()
    resolve(undefined)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })
})
