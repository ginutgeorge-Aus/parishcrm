/** @jest-environment jsdom */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { updateEntryQuantity, updateEntryDelivery, deleteEntry } from "@/lib/actions/fundraiser"
import { EntryTable } from "@/components/events/fundraiser/EntryTable"
import type { FundraiserRow } from "@/lib/fundraiserQueries"

jest.mock("@/lib/actions/fundraiser", () => ({
  updateEntryQuantity: jest.fn(),
  updateEntryDelivery: jest.fn(),
  deleteEntry: jest.fn(),
  recordPayment: jest.fn(),
  deletePayment: jest.fn(),
}))

const mUpdate = updateEntryQuantity as jest.Mock
const mDelete = deleteEntry as jest.Mock

const base = { familyId: null, quantity: 2, unitPrice: "10.00", delivery: false, bankRef: "REF1" }
const rows: FundraiserRow[] = [
  { ...base, id: 1, name: "Anna", owedCents: 2000, paidCents: 0, remainingCents: 2000, status: "UNPAID" },
  { ...base, id: 2, name: "Ben", owedCents: 2000, paidCents: 500, remainingCents: 1500, status: "PART" },
  { ...base, id: 3, name: "Cara", owedCents: 2000, paidCents: 2000, remainingCents: 0, status: "PAID" },
  { ...base, id: 4, name: "Dan", owedCents: 2000, paidCents: 3000, remainingCents: 0, status: "OVERPAID" },
]

test("renders each row's status badge from props, scoped to that row", () => {
  render(<EntryTable rows={rows} canManage={false} payments={{}} />)
  // Scope to each row: a bare "Paid" match would also hit the Paid column header.
  const expected: Record<string, string> = { Anna: "Unpaid", Ben: "Part paid", Cara: "Paid", Dan: "Overpaid" }
  for (const [name, label] of Object.entries(expected)) {
    const tableRow = screen.getByRole("cell", { name }).closest("tr") as HTMLElement
    expect(within(tableRow).getByText(label, { exact: true })).toBeInTheDocument()
  }
})

test("hides action buttons when canManage=false", () => {
  render(<EntryTable rows={rows} canManage={false} payments={{}} />)
  expect(screen.queryByRole("button", { name: /payments/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /delete/i })).toBeNull()
})

test("shows action buttons when canManage=true", () => {
  render(<EntryTable rows={rows} canManage payments={{}} />)
  expect(screen.getAllByRole("button", { name: /payments/i }).length).toBeGreaterThan(0)
  expect(screen.getAllByRole("button", { name: /delete/i }).length).toBeGreaterThan(0)
})

test("each row shows its own snapshot price", () => {
  const two: FundraiserRow[] = [
    { ...base, id: 1, name: "Old", unitPrice: "10.00", owedCents: 2000, paidCents: 0, remainingCents: 2000, status: "UNPAID" },
    { ...base, id: 2, name: "New", unitPrice: "12.50", owedCents: 2500, paidCents: 0, remainingCents: 2500, status: "UNPAID" },
  ]
  render(<EntryTable rows={two} canManage={false} payments={{}} />)
  expect(screen.getAllByText(/\$10\.00/).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/\$12\.50/).length).toBeGreaterThan(0)
})

const one = [rows[0]]

beforeEach(() => { jest.clearAllMocks(); mUpdate.mockResolvedValue({}); mDelete.mockResolvedValue({}) })

test("shows the empty state", () => {
  render(<EntryTable rows={[]} canManage={false} payments={{}} />)
  expect(screen.getByText("No entries yet.")).toBeInTheDocument()
})

test("saving a changed quantity calls the action", async () => {
  const user = userEvent.setup()
  render(<EntryTable rows={one} canManage payments={{}} />)
  const input = screen.getAllByLabelText("Quantity for Anna")[0]
  await user.clear(input)
  await user.type(input, "5")
  fireEvent.blur(input)
  await waitFor(() => expect(mUpdate).toHaveBeenCalledWith(1, "5"))
})

test("blur without change does not call the action", () => {
  render(<EntryTable rows={one} canManage payments={{}} />)
  fireEvent.blur(screen.getAllByLabelText("Quantity for Anna")[0])
  expect(mUpdate).not.toHaveBeenCalled()
})

test("quantity error is shown and the value reverts", async () => {
  mUpdate.mockResolvedValue({ error: "Bad qty" })
  const user = userEvent.setup()
  render(<EntryTable rows={one} canManage payments={{}} />)
  const input = screen.getAllByLabelText("Quantity for Anna")[0] as HTMLInputElement
  await user.clear(input)
  await user.type(input, "9")
  fireEvent.blur(input)
  expect((await screen.findAllByText("Bad qty")).length).toBeGreaterThan(0)
  await waitFor(() => expect(input.value).toBe("2"))
})

test("delete asks for confirmation in a dialog, then calls the action", async () => {
  const user = userEvent.setup()
  render(<EntryTable rows={one} canManage payments={{}} />)
  await user.click(screen.getAllByRole("button", { name: "Delete Anna" })[0])
  expect(mDelete).not.toHaveBeenCalled()
  expect(screen.getByText("Delete entry?")).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "Delete" }))
  await waitFor(() => expect(mDelete).toHaveBeenCalledWith(1))
})

test("delete error is shown", async () => {
  mDelete.mockResolvedValue({ error: "Cannot delete" })
  const user = userEvent.setup()
  render(<EntryTable rows={one} canManage payments={{}} />)
  await user.click(screen.getAllByRole("button", { name: "Delete Anna" })[0])
  await user.click(screen.getByRole("button", { name: "Delete" }))
  expect((await screen.findAllByText("Cannot delete")).length).toBeGreaterThan(0)
})

test("a thrown quantity save shows a generic error and restores the value", async () => {
  mUpdate.mockRejectedValue(new Error("network"))
  const user = userEvent.setup()
  render(<EntryTable rows={one} canManage payments={{}} />)
  const input = screen.getAllByLabelText("Quantity for Anna")[0] as HTMLInputElement
  await user.clear(input)
  await user.type(input, "5")
  await user.tab()
  expect((await screen.findAllByText("Could not save the quantity. Please try again.")).length).toBeGreaterThan(0)
  await waitFor(() => expect(input.value).toBe("2"))
})

test("shows the bank ref to staff", () => {
  render(<EntryTable rows={one} canManage={false} payments={{}} />)
  expect(screen.getAllByText(/REF1/).length).toBeGreaterThan(0)
})

test("quantity input resyncs when the row quantity changes", () => {
  const { rerender } = render(<EntryTable rows={one} canManage payments={{}} />)
  rerender(<EntryTable rows={[{ ...one[0], quantity: 7 }]} canManage payments={{}} />)
  expect((screen.getAllByLabelText("Quantity for Anna")[0] as HTMLInputElement).value).toBe("7")
})

test("hides Pickup/Delivery when the fundraiser has no delivery price", () => {
  render(<EntryTable rows={one} canManage payments={{}} />)
  expect(screen.queryByText("Pickup")).toBeNull()
  expect(screen.queryByLabelText("Pickup or delivery for Anna")).toBeNull()
})

test("shows the type per row and switches it via updateEntryDelivery", async () => {
  ;(updateEntryDelivery as jest.Mock).mockResolvedValue(undefined)
  const two: FundraiserRow[] = [one[0], { ...rows[1], delivery: true }]
  render(<EntryTable rows={two} canManage payments={{}} hasDelivery />)
  expect(screen.getAllByText("Delivery").length).toBeGreaterThan(0)
  fireEvent.change(screen.getAllByLabelText("Pickup or delivery for Anna")[0], { target: { value: "delivery" } })
  await waitFor(() => expect(updateEntryDelivery).toHaveBeenCalledWith(1, true))
})

test("delivery switch error is shown", async () => {
  ;(updateEntryDelivery as jest.Mock).mockResolvedValue({ error: "Below paid" })
  render(<EntryTable rows={one} canManage payments={{}} hasDelivery />)
  fireEvent.change(screen.getAllByLabelText("Pickup or delivery for Anna")[0], { target: { value: "delivery" } })
  expect((await screen.findAllByText("Below paid")).length).toBeGreaterThan(0)
})
