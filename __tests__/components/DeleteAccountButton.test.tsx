/**
 * @jest-environment jsdom
 *
 * missing component test for DeleteAccountButton. Covers opening the
 * confirm dialog, invoking the delete action with the account id, surfacing a
 * server error on failure, and clearing a stale error when the dialog is closed.
 *
 * Updated for/: now delegates to the shared DeleteConfirmButton which
 * keeps the dialog open on error (error renders inside the dialog) and clears the
 * error on dialog close (onOpenChange: `if (!o) setError(null)`).
 */
import { render, screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DeleteAccountButton } from "@/components/accounting/DeleteAccountButton"

jest.mock("@/lib/actions/account", () => ({
  deleteAccount: jest.fn(),
}))
import { deleteAccount } from "@/lib/actions/account"

const mockDelete = deleteAccount as jest.Mock

beforeEach(() => jest.clearAllMocks())

async function openDialog() {
  const user = userEvent.setup()
  render(<DeleteAccountButton accountId={7} accountName="Petty Cash" />)
  await user.click(screen.getByRole("button", { name: "Delete" })) // trigger
  const dialog = await screen.findByRole("alertdialog")
  return { user, dialog }
}

describe("DeleteAccountButton", () => {
  it("opens the confirm dialog with the account name", async () => {
    const { dialog } = await openDialog()
    expect(within(dialog).getByText("Delete Petty Cash?")).toBeInTheDocument()
  })

  it("invokes deleteAccount with the account id on confirm", async () => {
    mockDelete.mockResolvedValue(undefined)
    const { user, dialog } = await openDialog()

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(7))
  })

  it("keeps the dialog open and shows the server error on failure", async () => {
    mockDelete.mockResolvedValue({ error: "Account has transactions." })
    const { user, dialog } = await openDialog()

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(await screen.findByText("Account has transactions.")).toBeInTheDocument()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })

  it("clears a stale error when the dialog is closed", async () => {
    mockDelete.mockResolvedValue({ error: "Account has transactions." })
    const { user, dialog } = await openDialog()

    // Trigger the error (dialog stays open; error renders inside).
    await user.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect(await screen.findByText("Account has transactions.")).toBeInTheDocument()

    // Close via Cancel → onOpenChange(false) clears the error.
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }))
    await waitFor(() =>
      expect(screen.queryByText("Account has transactions.")).not.toBeInTheDocument()
    )
  })
})
