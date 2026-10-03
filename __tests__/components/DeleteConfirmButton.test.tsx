/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"

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
