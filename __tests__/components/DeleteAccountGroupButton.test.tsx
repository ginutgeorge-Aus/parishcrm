/**
 * @jest-environment jsdom
 *
 * the AlertDialog action button closed the dialog synchronously on click
 * (Radix default), so an error set by the async delete landed after the dialog
 * had already dismissed and cleared it — the user never saw why the delete
 * failed. The fix suppresses the auto-close (preventDefault) and closes the
 * dialog explicitly only on success.
 */
import { render, screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DeleteAccountGroupButton } from "@/components/accounting/DeleteAccountGroupButton"

jest.mock("@/lib/actions/accountGroup", () => ({
  deleteAccountGroup: jest.fn(),
}))
import { deleteAccountGroup } from "@/lib/actions/accountGroup"

const mockDelete = deleteAccountGroup as jest.Mock

beforeEach(() => jest.clearAllMocks())

async function openDialog() {
  const user = userEvent.setup()
  render(<DeleteAccountGroupButton groupId={5} groupName="Offerings" />)
  await user.click(screen.getByRole("button", { name: "Delete" })) // trigger
  const dialog = await screen.findByRole("alertdialog")
  return { user, dialog }
}

describe("DeleteAccountGroupButton", () => {
  it("keeps the dialog open and shows the server error on failure", async () => {
    mockDelete.mockResolvedValue({ error: "Reassign or delete accounts in this group first." })
    const { user, dialog } = await openDialog()

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(await screen.findByText("Reassign or delete accounts in this group first.")).toBeInTheDocument()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })

  it("closes the dialog on success", async () => {
    mockDelete.mockResolvedValue(undefined)
    const { user, dialog } = await openDialog()

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })
})
