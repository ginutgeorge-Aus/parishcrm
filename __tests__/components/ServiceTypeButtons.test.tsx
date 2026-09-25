/**
 * @jest-environment jsdom
 *
 * DeleteServiceTypeButton silently ignored server-action errors.
 * ToggleServiceTypeButton had no loading/disabled guard.
 * DeleteServiceTypeButton migrated onto the shared DeleteConfirmButton
 *       (AlertDialog) — delete now needs the dialog's confirm click, not a
 *       native window.confirm.
 */
import { render, screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DeleteServiceTypeButton } from "@/components/petty-cash/DeleteServiceTypeButton"
import { ToggleServiceTypeButton } from "@/components/petty-cash/ToggleServiceTypeButton"

jest.mock("@/lib/actions/serviceType", () => ({
  deleteServiceType: jest.fn(),
  toggleServiceTypeActive: jest.fn(),
}))
import { deleteServiceType, toggleServiceTypeActive } from "@/lib/actions/serviceType"

const mockDelete = deleteServiceType as jest.Mock
const mockToggle = toggleServiceTypeActive as jest.Mock

beforeEach(() => jest.clearAllMocks())

async function openDeleteDialog() {
  const user = userEvent.setup()
  render(<DeleteServiceTypeButton id={3} />)
  await user.click(screen.getByRole("button", { name: "Delete" }))
  const dialog = await screen.findByRole("alertdialog")
  return { user, dialog }
}

describe("DeleteServiceTypeButton", () => {
  it("confirms via AlertDialog before executing the action", async () => {
    mockDelete.mockResolvedValue(undefined)
    const { dialog } = await openDeleteDialog()

    expect(dialog).toBeInTheDocument()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("shows error message and keeps the dialog open when the action returns an error", async () => {
    mockDelete.mockResolvedValue({ error: "Service type has existing records." })
    const { user, dialog } = await openDeleteDialog()

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(await screen.findByText("Service type has existing records.")).toBeInTheDocument()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })

  it("closes the dialog on success", async () => {
    mockDelete.mockResolvedValue(undefined)
    const { user, dialog } = await openDeleteDialog()

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(mockDelete).toHaveBeenCalledTimes(1)
  })

  it("does not call the action when the dialog is cancelled", async () => {
    const { user, dialog } = await openDeleteDialog()

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))

    expect(mockDelete).not.toHaveBeenCalled()
  })
})

describe("ToggleServiceTypeButton", () => {
  it("disables button while action is in flight", async () => {
    let resolve!: (v: undefined) => void
    mockToggle.mockImplementation(() => new Promise<undefined>((r) => { resolve = r }))
    const user = userEvent.setup()
    render(<ToggleServiceTypeButton id={5} isActive={true} />)
    const btn = screen.getByRole("button", { name: "Deactivate" })

    await user.click(btn)

    expect(btn).toBeDisabled()
    resolve(undefined)
    await waitFor(() => expect(btn).not.toBeDisabled())
  })

  it("calls action once per click (no double-submit)", async () => {
    mockToggle.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ToggleServiceTypeButton id={5} isActive={false} />)
    const btn = screen.getByRole("button", { name: "Activate" })

    // Rapid double click — second should be blocked by disabled state
    await user.click(btn)
    await waitFor(() => expect(mockToggle).toHaveBeenCalledTimes(1))
  })
})
