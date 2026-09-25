/**
 * @jest-environment jsdom
 *
 * DeletePersonButton closed the dialog before confirming success,
 * silently swallowing errors. The fix suppresses Radix's auto-close and
 * only calls setOpen(false) on the success path.
 */
import { render, screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DeletePersonButton } from "@/components/people/DeletePersonButton"

jest.mock("@/lib/actions/person", () => ({
  deletePerson: jest.fn(),
}))
import { deletePerson } from "@/lib/actions/person"

const mockDelete = deletePerson as jest.Mock

beforeEach(() => jest.clearAllMocks())

async function openDialog() {
  const user = userEvent.setup()
  render(<DeletePersonButton personId={1} familyId={2} personName="John Smith" />)
  await user.click(screen.getByRole("button", { name: "Delete" }))
  const dialog = await screen.findByRole("alertdialog")
  return { user, dialog }
}

describe("DeletePersonButton", () => {
  it("keeps dialog open and shows error on action failure", async () => {
    mockDelete.mockResolvedValue({ error: "Cannot delete person with records." })
    const { user, dialog } = await openDialog()

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(await screen.findByText("Cannot delete person with records.")).toBeInTheDocument()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })

  it("closes dialog on success", async () => {
    mockDelete.mockResolvedValue(undefined)
    const { user, dialog } = await openDialog()

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("clears error when dialog is reopened", async () => {
    mockDelete.mockResolvedValueOnce({ error: "Some error." }).mockResolvedValueOnce(undefined)
    const { user, dialog } = await openDialog()

    // Trigger error
    await user.click(within(dialog).getByRole("button", { name: "Delete" }))
    await screen.findByText("Some error.")

    // Close via Cancel then reopen
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByText("Some error.")).not.toBeInTheDocument())
  })
})
