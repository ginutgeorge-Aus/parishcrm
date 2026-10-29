import { render, screen, fireEvent } from "@testing-library/react"
import { TransferForm } from "@/components/petty-cash/TransferForm"

jest.mock("next/navigation", () => ({ useRouter: () => ({ back: jest.fn() }) }))

const noop = async () => undefined
const imported = [{ id: 7, date: "2026-07-31", amount: "50.00", description: "Cash deposit" }]

test("hides the picker when there are no imported deposits", () => {
  render(<TransferForm action={noop} maxAmount={100} />)
  expect(screen.queryByLabelText(/imported bank deposit/i)).not.toBeInTheDocument()
})

test("picking an imported deposit prefills and locks date + amount", () => {
  render(<TransferForm action={noop} maxAmount={100} imported={imported} />)
  fireEvent.change(screen.getByLabelText(/imported bank deposit/i), { target: { value: "7" } })
  const date = screen.getByLabelText(/transfer date/i) as HTMLInputElement
  const amount = screen.getByLabelText(/amount deposited/i) as HTMLInputElement
  expect(date.value).toBe("2026-07-31")
  expect(amount.value).toBe("50.00")
  expect(date).toHaveAttribute("readonly")
  expect(amount).toHaveAttribute("readonly")
})

test("clearing the pick makes fields editable again", () => {
  render(<TransferForm action={noop} maxAmount={100} imported={imported} />)
  const select = screen.getByLabelText(/imported bank deposit/i)
  fireEvent.change(select, { target: { value: "7" } })
  fireEvent.change(select, { target: { value: "" } })
  expect(screen.getByLabelText(/amount deposited/i)).not.toHaveAttribute("readonly")
})

test("submits the picked id via a hidden input that survives a form reset", () => {
  const { container } = render(<TransferForm action={noop} maxAmount={100} imported={imported} />)
  fireEvent.change(screen.getByLabelText(/imported bank deposit/i), { target: { value: "7" } })
  const hidden = container.querySelector('input[name="importedTransactionId"]') as HTMLInputElement
  expect(hidden.type).toBe("hidden")
  expect(hidden.value).toBe("7")
  // React 19 resets the form after a failed action; state (not the DOM) must carry the id.
  container.querySelector("form")!.reset()
  expect(hidden.value).toBe("7")
  expect(screen.getByLabelText(/imported bank deposit/i)).not.toHaveAttribute("name")
})

test("shows a truncation notice only when the list was capped", () => {
  const { rerender } = render(<TransferForm action={noop} maxAmount={100} imported={imported} />)
  expect(screen.queryByText(/older ones are not listed/i)).not.toBeInTheDocument()
  rerender(<TransferForm action={noop} maxAmount={100} imported={imported} importedTruncated />)
  expect(screen.getByText(/older ones are not listed/i)).toBeInTheDocument()
})
