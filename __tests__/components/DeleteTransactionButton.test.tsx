/**
 * @jest-environment jsdom
 *
 * missing component test for DeleteTransactionButton. Covers opening the
 * confirm dialog, invoking the delete action, and surfacing a server error on
 * failure.
 *
 * Updated for/: now delegates to the shared DeleteConfirmButton which
 * keeps the dialog open on error (error renders inside the dialog) and closes
 * only on success. The confirm button is disabled while the action is in flight.
 */
import { render, screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DeleteTransactionButton } from "@/components/accounting/DeleteTransactionButton"

jest.mock("@/lib/actions/transaction", () => ({
  deleteTransaction: jest.fn(),
}))
import { deleteTransaction } from "@/lib/actions/transaction"

const mockDelete = deleteTransaction as jest.Mock

beforeEach(() => jest.clearAllMocks())

async function openDialog() {
  const user = userEvent.setup()
  render(<DeleteTransactionButton id={42} />)
  await user.click(screen.getByRole("button", { name: "Delete" })) // trigger
  const dialog = await screen.findByRole("alertdialog")
  return { user, dialog }
}

describe("DeleteTransactionButton", () => {
  it("opens the confirm dialog from the trigger", async () => {
    const { dialog } = await openDialog()
    expect(within(dialog).getByText("Delete this transaction?")).toBeInTheDocument()
  })

  it("invokes deleteTransaction with the id on confirm", async () => {
    mockDelete.mockResolvedValue(undefined)
    const { user, dialog } = await openDialog()

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(42))
  })

  it("closes the dialog on successful delete", async () => {
    mockDelete.mockResolvedValue(undefined)
    const { user, dialog } = await openDialog()

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("shows the server error when the delete fails", async () => {
    mockDelete.mockResolvedValue({ error: "Transaction is reconciled." })
    const { user, dialog } = await openDialog()

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(await screen.findByText("Transaction is reconciled.")).toBeInTheDocument()
  })

  it("renders an inert button with an accessible reason and opens no dialog when locked", async () => {
    const user = userEvent.setup()
    render(<DeleteTransactionButton id={42} locked />)
    const btn = screen.getByRole("button", { name: "Delete" })
    expect(btn).toBeDisabled()
    // Reason is surfaced as visible text + aria-describedby, not the title attribute.
    const describedBy = btn.getAttribute("aria-describedby")
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toHaveTextContent("Period locked")
    await user.click(btn)
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(mockDelete).not.toHaveBeenCalled()
  })
})
