/**
 * @jest-environment jsdom
 *
 * AUD-8-01: a rejected transaction save keeps the typed date (it used to snap
 * back to today), and "Post anyway" re-submits the kept values.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TransactionForm } from "@/components/accounting/TransactionForm"

// Plain native <select> so a category can be picked without Radix internals.
jest.mock("@/components/ui/select", () => ({
  Select: ({ name, value, onValueChange, children }: { name?: string; value?: string; onValueChange?: (v: string) => void; children: React.ReactNode }) => (
    <select name={name} value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectLabel: () => null,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}))

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn()
})

const props = {
  accounts: [{ id: 1, code: "4001", name: "Offering", type: "INCOME" as const }],
  families: [],
  funds: [{ id: 1, name: "General" }],
  paymentAccounts: [],
}

it("keeps the typed date and amount after a rejection, and Post anyway re-sends them", async () => {
  const action = jest
    .fn()
    .mockResolvedValueOnce({ error: "Possible duplicate", duplicateWarning: true })
    .mockResolvedValueOnce(undefined)
  render(<TransactionForm action={action} {...props} />)
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-03-04" } })
  await userEvent.type(screen.getByLabelText(/Amount/), "12.50")
  await userEvent.type(screen.getByLabelText("Description"), "Plate offering")
  await userEvent.click(screen.getByRole("button", { name: /Add|Save|Create|Record/ }))
  const alert = await screen.findByRole("alert")
  await waitFor(() => expect(alert).toHaveFocus())
  expect(screen.getByLabelText("Date")).toHaveValue("2026-03-04")
  expect(screen.getByLabelText(/Amount/)).toHaveValue(12.5)
  expect(screen.getByLabelText("Description")).toHaveValue("Plate offering")

  await userEvent.click(screen.getByRole("button", { name: "Post anyway" }))
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2))
  const fd = action.mock.calls[1][1] as FormData
  expect(fd.get("confirmDuplicate")).toBe("true")
  expect(fd.get("date")).toBe("2026-03-04")
  expect(fd.get("amount")).toBe("12.50")
})
