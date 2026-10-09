/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react"
import { unstable_rethrow } from "next/navigation"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"

jest.mock("next/navigation", () => ({ unstable_rethrow: jest.fn() }))
const mockRethrow = unstable_rethrow as jest.Mock
beforeEach(() => mockRethrow.mockReset())

async function confirmWith(onConfirm: () => Promise<unknown>) {
  render(<DeleteConfirmButton onConfirm={onConfirm as never} title="Delete thing?" description="Gone for good." />)
  fireEvent.click(screen.getByRole("button", { name: "Delete" }))
  const dialog = await screen.findByRole("alertdialog")
  const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Delete")!
  await act(async () => { fireEvent.click(confirm) })
}

test("a rejected onConfirm keeps the dialog open and shows an inline error", async () => {
  await confirmWith(() => Promise.reject(new Error("network down")))
  expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  expect(screen.getByRole("alert")).toHaveTextContent(/something went wrong/i)
})

test("an { error } result is shown inline", async () => {
  await confirmWith(() => Promise.resolve({ error: "In use" }))
  expect(screen.getByRole("alert")).toHaveTextContent("In use")
})

test("success closes the dialog", async () => {
  await confirmWith(() => Promise.resolve({ success: true }))
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
})

test("Next control-flow errors (redirect after a successful delete) are re-thrown, not swallowed", async () => {
  const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/families;307;" })
  mockRethrow.mockImplementation((e: unknown) => { throw e })
  // The rethrown error becomes an unhandled rejection inside startTransition; observe it.
  const unhandled = jest.fn()
  process.on("unhandledRejection", unhandled)
  try {
    await confirmWith(() => Promise.reject(redirectErr))
  } catch (e) {
    expect(e).toBe(redirectErr)
  } finally {
    process.off("unhandledRejection", unhandled)
  }
  expect(mockRethrow).toHaveBeenCalledWith(redirectErr)
  expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
})
